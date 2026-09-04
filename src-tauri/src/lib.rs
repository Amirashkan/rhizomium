// Desktop entry point.
//
// The desktop app has no landing page: the main window is the editor itself,
// created hidden, and a small borderless splash window covers the second or two
// the editor spends acquiring a GPU adapter and compiling its first shader. The
// handoff between the two is the `app_ready` command below.
//
// Beyond opening the editor window, this handles the OS file association for
// `.rz`: double-clicking a Rhizomium patch (or passing one on the command line)
// must open it in the editor. The path arrives one of two ways depending on the
// platform, so both are funnelled into the same pending-file slot that the
// frontend drains once it has booted:
//
//   - Windows/Linux: the file is a launch argument.
//   - macOS: the OS sends a `RunEvent::Opened`, which can also arrive while the
//     app is already running. That variant only exists on Apple platforms, so
//     everything touching it is cfg-gated.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// The patches the OS has asked us to open.
///
/// `pending` is the slot the frontend drains once on boot. `offered` is every
/// path we have handed the webview this session, and it is what authorises a
/// read: see `read_project_file`.
struct PendingOpen {
    pending: Mutex<Option<String>>,
    offered: Mutex<HashSet<String>>,
}

impl PendingOpen {
    fn new(path: Option<String>) -> Self {
        Self {
            offered: Mutex::new(path.iter().cloned().collect()),
            pending: Mutex::new(path),
        }
    }

    /// Record a path the OS gave us, and park it for the frontend.
    ///
    /// The only caller is `handle_opened`, which is macOS/iOS-only, so on every
    /// other platform this is genuinely dead code and rustc says so. The
    /// warning is correct and not actionable — a Windows build has no
    /// `RunEvent::Opened` to answer — so silence it exactly where it applies.
    /// Left loud on Apple targets, where an unused `offer` would be a real bug.
    #[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
    fn offer(&self, path: String) {
        if let Ok(mut offered) = self.offered.lock() {
            offered.insert(path.clone());
        }
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(path);
        }
    }

    /// Take the parked path, leaving the slot empty.
    fn take(&self) -> Option<String> {
        self.pending.lock().ok().and_then(|mut pending| pending.take())
    }

    /// Did the OS hand us this exact path?
    fn was_offered(&self, path: &str) -> bool {
        self.offered
            .lock()
            .map(|offered| offered.contains(path))
            .unwrap_or(false)
    }
}

/// The editor. Configured hidden in tauri.conf.json; revealed by `app_ready`.
const MAIN_WINDOW: &str = "main";

/// The borderless launch window (splash.html).
const SPLASH_WINDOW: &str = "splashscreen";

/// How long the splash is allowed to stand in for the editor.
///
/// The frontend calls `app_ready` on every exit from its boot path, including
/// the failure ones, so under normal operation this never fires. It exists for
/// the case the frontend cannot report at all — a bundle that fails to parse,
/// a webview that dies during startup. Without it the app would be a splash
/// screen with no title bar, no menu and no way to close it short of the task
/// manager; with it the editor window appears and the user can at least read
/// the error and quit.
const SPLASH_TIMEOUT: Duration = Duration::from_secs(20);

/// Event emitted when a patch is opened while the editor is already running.
#[cfg(any(target_os = "macos", target_os = "ios"))]
const OPEN_FILE_EVENT: &str = "rhizomium://open-file";

/// Does this look like a patch we should offer to open?
///
/// A filter for picking our file out of the launch arguments or a list of
/// dropped URLs -- deliberately not a permission check. An extension is not a
/// boundary: every `.json` on the machine has one, and plenty of them are
/// somebody's credentials. What authorises a read is `PendingOpen::offered`.
fn is_project_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".rz") || lower.ends_with(".json")
}

/// First `.rz`/`.json` path among the launch arguments.
fn project_path_from_args() -> Option<String> {
    std::env::args().skip(1).find(|arg| is_project_path(arg))
}

/// Hand the frontend the file the app was launched with, exactly once.
///
/// The editor asks for this after it boots; returning None (the common case,
/// a plain app launch) means "nothing to open".
#[tauri::command]
fn take_pending_open(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    state.take()
}

/// Read a patch from disk for the frontend.
///
/// This is reachable from the webview, so it must not become a general "read
/// any file" primitive -- and matching on the extension did not stop it being
/// one, since it would open any `.json` anywhere on the machine.
///
/// The webview never has a path of its own to open. Both ways a patch arrives
/// start here in Rust, from the OS: a launch argument, or a `RunEvent::Opened`.
/// The frontend only ever echoes back the path `take_pending_open()` or the
/// open event handed it. So the check is membership, not shape: we open a file
/// the OS asked us to open, and nothing else.
#[tauri::command]
fn read_project_file(path: String, state: tauri::State<'_, PendingOpen>) -> Result<String, String> {
    if !state.was_offered(&path) {
        // Deliberately not "no such file": whether it exists is not something
        // the webview has earned an answer to.
        return Err("Not a patch this app was asked to open".into());
    }
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

/// File the editor autosaves into, inside the app data directory.
///
/// Autosave used to live in the webview's localStorage, which caps out around
/// 5MB - a patch with an inlined texture, let alone a video, blew past that and
/// every autosave failed. On the desktop there is no reason to squeeze a patch
/// into browser storage: it goes to disk like any other document.
const AUTOSAVE_FILE: &str = "autosave.rz";

fn autosave_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("No app data directory: {err}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not create {}: {err}", dir.display()))?;
    Ok(dir.join(AUTOSAVE_FILE))
}

/// Write the autosave snapshot.
///
/// Written to a temporary file and renamed into place, so a crash or a power
/// cut partway through a multi-megabyte write leaves the previous snapshot
/// intact instead of a half-written one.
#[tauri::command]
fn write_autosave(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = autosave_path(&app)?;
    let temp = path.with_extension("rz.tmp");

    std::fs::write(&temp, contents.as_bytes())
        .map_err(|err| format!("Could not write the autosave: {err}"))?;
    std::fs::rename(&temp, &path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        format!("Could not replace the autosave: {err}")
    })
}

/// Read the autosave snapshot, or None when there is not one yet.
#[tauri::command]
fn read_autosave(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = autosave_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Could not read the autosave: {err}")),
    }
}

/// Discard the autosave snapshot.
#[tauri::command]
fn clear_autosave(app: tauri::AppHandle) -> Result<(), String> {
    let path = autosave_path(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Could not clear the autosave: {err}")),
    }
}

/// Whether the splash has already handed over to the editor.
///
/// The handoff must happen exactly once. It has two possible callers — the
/// frontend and the `SPLASH_TIMEOUT` thread — and the frontend itself reaches
/// it from more than one place, so this is what makes a second call harmless.
/// Not merely redundant: `reveal_editor` focuses the editor window, and doing
/// that again twenty seconds into a session would yank focus off whatever the
/// artist had switched to.
static REVEALED: AtomicBool = AtomicBool::new(false);

/// Hand the screen over from the splash window to the editor.
///
/// Order matters: show the editor first, then close the splash. Closing first
/// leaves a frame or two with neither window on screen, which on macOS also
/// bounces focus to whatever application is behind Rhizomium.
fn reveal_editor(app: &tauri::AppHandle) {
    use tauri::Manager;

    if REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = splash.close();
    }
}

/// The editor reporting that it has finished booting.
///
/// Called from src/core/tauriSplash.js once initialize() has run to completion
/// — or failed, or been skipped because the device check rejected the GPU. All
/// three want the same thing: the splash gone and the editor on screen, either
/// showing the graph or showing why it cannot.
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    reveal_editor(&app);
}

/// macOS delivers file-association opens as an event rather than as arguments,
/// both on a cold launch and while the editor is already open.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn handle_opened(handle: &tauri::AppHandle, event: &tauri::RunEvent) {
    use tauri::{Emitter, Manager};

    let tauri::RunEvent::Opened { urls } = event else {
        return;
    };

    let path = urls.iter().filter_map(|url| url.to_file_path().ok()).find_map(|path| {
        let path = path.to_string_lossy().to_string();
        is_project_path(&path).then_some(path)
    });

    let Some(path) = path else { return };

    // On a cold launch the webview may not be listening yet, so stash the path
    // as well as emitting it. Whichever the frontend reaches first wins, and
    // take_pending_open() clears the slot so the file cannot open twice.
    if let Some(state) = handle.try_state::<PendingOpen>() {
        state.offer(path.clone());
    }
    let _ = handle.emit(OPEN_FILE_EVENT, path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingOpen::new(project_path_from_args()))
        .invoke_handler(tauri::generate_handler![
            take_pending_open,
            read_project_file,
            write_autosave,
            read_autosave,
            clear_autosave,
            app_ready
        ])
        .setup(|app| {
            // Dead man's switch for the splash — see SPLASH_TIMEOUT.
            // AppHandle is Send + Sync and the window methods dispatch to the
            // runtime themselves, so a plain sleeping thread is enough here.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SPLASH_TIMEOUT);
                reveal_editor(&handle);
            });

            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        handle_opened(_handle, &_event);
    });
}
