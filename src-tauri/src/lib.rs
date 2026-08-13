// Desktop entry point.
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

use std::sync::Mutex;

/// Path waiting to be opened by the frontend, if any.
struct PendingOpen(Mutex<Option<String>>);

/// Event emitted when a patch is opened while the editor is already running.
#[cfg(any(target_os = "macos", target_os = "ios"))]
const OPEN_FILE_EVENT: &str = "rhizomium://open-file";

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
    state.0.lock().ok().and_then(|mut pending| pending.take())
}

/// Read a project file from disk for the frontend.
///
/// Scoped to project documents on purpose: this is reachable from the webview,
/// so it must not become a general "read any file" primitive.
#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    if !is_project_path(&path) {
        return Err("Not a Rhizomium project file".into());
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
        if let Ok(mut pending) = state.0.lock() {
            *pending = Some(path.clone());
        }
    }
    let _ = handle.emit(OPEN_FILE_EVENT, path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingOpen(Mutex::new(project_path_from_args())))
        .invoke_handler(tauri::generate_handler![
            take_pending_open,
            read_project_file,
            write_autosave,
            read_autosave,
            clear_autosave
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                let window = _app.get_webview_window("main").unwrap();
                window.open_devtools();
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
