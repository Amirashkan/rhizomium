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

/// The media files the artist has handed the app: picked in a native dialog,
/// dropped on the editor, or found by a relink search in a folder they picked.
///
/// A project saves its images, videos, audio and fonts by path rather than
/// inlining their bytes, so reopening it means reading those paths again.
/// `read_media_file` is how, and like `read_project_file` it must not become a
/// way for the webview to read whatever it likes. The check is the same kind:
/// membership. A path is readable because the artist chose that file, never
/// because it ends in `.png` — and a project naming paths nobody granted (one
/// from another machine, or a crafted one) gets a relink prompt instead.
///
/// Grants are written to the app data directory so a project saved yesterday
/// still opens today; the folders picked for a relink search are trusted for
/// this session only.
struct MediaGrants {
    inner: Mutex<MediaGrantsInner>,
}

#[derive(Default)]
struct MediaGrantsInner {
    loaded: bool,
    files: Vec<String>,
    folders: HashSet<String>,
}

/// Where the grants live, one path per line.
const MEDIA_GRANTS_FILE: &str = "media-grants.txt";

/// Oldest grants are forgotten past this, so the file cannot grow forever.
const MAX_MEDIA_GRANTS: usize = 20_000;

/// Largest media file read back into the webview. Past this the bytes would
/// not fit in one ArrayBuffer anyway.
const MAX_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// How deep, and how far, a relink search walks a picked folder, and how many
/// files of one name it answers with.
const MEDIA_SEARCH_DEPTH: usize = 8;
const MEDIA_SEARCH_ENTRIES: usize = 50_000;
const MEDIA_SEARCH_MATCHES: usize = 256;

/// Event a file dropped on the editor arrives as - after it has been granted.
const MEDIA_DROP_EVENT: &str = "rhizomium://media-drop";

fn media_grants_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|dir| dir.join(MEDIA_GRANTS_FILE))
}

impl MediaGrants {
    fn new() -> Self {
        Self { inner: Mutex::new(MediaGrantsInner::default()) }
    }

    /// The grants, read from disk the first time anything asks.
    fn with<T>(&self, app: &tauri::AppHandle, f: impl FnOnce(&mut MediaGrantsInner) -> T) -> Option<T> {
        let mut inner = self.inner.lock().ok()?;
        if !inner.loaded {
            inner.loaded = true;
            if let Some(contents) = media_grants_path(app).and_then(|p| std::fs::read_to_string(p).ok()) {
                inner.files = contents.lines().filter(|l| !l.is_empty()).map(str::to_string).collect();
            }
        }
        Some(f(&mut inner))
    }

    fn grant_files(&self, app: &tauri::AppHandle, paths: &[String]) {
        let changed = self
            .with(app, |inner| {
                let mut changed = false;
                for path in paths {
                    // A newline in a path would split it into two grants on reload.
                    if path.is_empty() || path.contains('\n') {
                        continue;
                    }
                    if let Some(at) = inner.files.iter().position(|p| p == path) {
                        // Most recent last, so the cap drops the stalest.
                        let existing = inner.files.remove(at);
                        inner.files.push(existing);
                    } else {
                        inner.files.push(path.clone());
                    }
                    changed = true;
                }
                if inner.files.len() > MAX_MEDIA_GRANTS {
                    let excess = inner.files.len() - MAX_MEDIA_GRANTS;
                    inner.files.drain(..excess);
                }
                changed.then(|| inner.files.join("\n"))
            })
            .flatten();

        if let (Some(contents), Some(path)) = (changed, media_grants_path(app)) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, contents);
        }
    }

    fn grant_folder(&self, app: &tauri::AppHandle, path: &str) {
        self.with(app, |inner| inner.folders.insert(path.to_string()));
    }

    fn is_file_granted(&self, app: &tauri::AppHandle, path: &str) -> bool {
        self.with(app, |inner| inner.files.iter().any(|p| p == path)).unwrap_or(false)
    }

    fn is_folder_granted(&self, app: &tauri::AppHandle, path: &str) -> bool {
        self.with(app, |inner| inner.folders.contains(path)).unwrap_or(false)
    }
}

/// Extensions offered by the media pickers, per kind of input.
fn media_filter(kind: &str) -> (&'static str, &'static [&'static str]) {
    const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];
    const IMAGE_AND_VIDEO: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "mp4", "m4v", "webm", "ogv", "mov",
    ];
    const AUDIO: &[&str] = &["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac", "weba", "webm", "aif", "aiff"];
    const FONT: &[&str] = &["ttf", "otf", "woff", "woff2", "ttc"];
    match kind {
        "audio" => ("Audio", AUDIO),
        "font" => ("Fonts", FONT),
        "texture" => ("Images and videos", IMAGE_AND_VIDEO),
        _ => ("Images", IMAGE),
    }
}

fn path_string(path: tauri_plugin_dialog::FilePath) -> Option<String> {
    path.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

/// Pick media files in a native dialog and grant them.
///
/// Async so the blocking dialog runs off the main thread, which it would
/// otherwise deadlock.
#[tauri::command]
async fn pick_media_files(
    app: tauri::AppHandle,
    grants: tauri::State<'_, MediaGrants>,
    kind: String,
    multiple: bool,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (name, extensions) = media_filter(&kind);
    let dialog = app.dialog().file().add_filter(name, extensions);
    let picked: Vec<String> = if multiple {
        dialog.blocking_pick_files().unwrap_or_default().into_iter().filter_map(path_string).collect()
    } else {
        dialog.blocking_pick_file().and_then(path_string).into_iter().collect()
    };
    grants.grant_files(&app, &picked);
    Ok(picked)
}

/// Pick a folder for a relink search, or to store embedded media in. Trusted
/// for this session only, and only for `find_media_in_folder` and
/// `write_media_file`: it does not make the files already in it readable.
#[tauri::command]
async fn pick_media_folder(
    app: tauri::AppHandle,
    grants: tauri::State<'_, MediaGrants>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder().and_then(path_string);
    if let Some(folder) = &folder {
        grants.grant_folder(&app, folder);
    }
    Ok(folder)
}

/// Look for files by name under a folder the artist picked, and grant the
/// ones found. Answers `{ name: [path, ...] }` for every name that matched,
/// every file of that name rather than the first: a folder of projects holds
/// an `image.png` in each, and the frontend picks the one whose folders match
/// the missing path's (closestPath in mediaPaths.js). Names are compared
/// without regard to case.
#[tauri::command]
async fn find_media_in_folder(
    app: tauri::AppHandle,
    grants: tauri::State<'_, MediaGrants>,
    folder: String,
    names: Vec<String>,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    if !grants.is_folder_granted(&app, &folder) {
        return Err("not-granted".into());
    }

    let wanted: std::collections::HashMap<String, String> =
        names.into_iter().map(|name| (name.to_lowercase(), name)).collect();
    let mut found: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut stack = vec![(std::path::PathBuf::from(&folder), 0usize)];
    let mut seen = 0usize;

    while let Some((dir, depth)) = stack.pop() {
        if wanted.is_empty() || seen >= MEDIA_SEARCH_ENTRIES {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_dir() {
                if depth < MEDIA_SEARCH_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else if file_type.is_file() {
                let key = entry.file_name().to_string_lossy().to_lowercase();
                if let Some(name) = wanted.get(&key) {
                    let paths = found.entry(name.clone()).or_default();
                    if paths.len() < MEDIA_SEARCH_MATCHES {
                        paths.push(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    let paths: Vec<String> = found.values().flatten().cloned().collect();
    grants.grant_files(&app, &paths);
    Ok(found)
}

/// Read a granted media file's bytes, raw rather than as a JSON number array.
///
/// Errors are plain codes the frontend tells apart: `not-granted` and
/// `not-found` both send the file to the relink prompt.
#[tauri::command]
async fn read_media_file(
    app: tauri::AppHandle,
    grants: tauri::State<'_, MediaGrants>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if !grants.is_file_granted(&app, &path) {
        return Err("not-granted".into());
    }
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err("not-found".into()),
        Err(err) => return Err(err.to_string()),
    };
    if !metadata.is_file() {
        return Err("not-found".into());
    }
    if metadata.len() > MAX_MEDIA_BYTES {
        return Err("too-large".into());
    }
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|err| err.to_string())
}

/// Undo the frontend's encodeURIComponent: header values must be ASCII, file
/// names and folders need not be.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A file name safe to create on any platform, or None when nothing usable is
/// left of it. Only ever a name: separators are dropped, so it cannot climb
/// out of the folder it is written into.
fn safe_file_name(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(150)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// Write one embedded piece of media out as a file, so the project can name it
/// by path from then on (SaveLoadManager.storeEmbeddedMedia, a temporary
/// console-only aid for converting projects saved before media went by path).
///
/// The bytes come as the raw request body; the folder and the file name as
/// percent-encoded `x-folder` / `x-name` headers. The folder must be one the
/// artist picked this session (`pick_media_folder`), and the name is reduced to
/// a bare file name. An existing file with the same bytes is reused; one with
/// different bytes is never overwritten - the new file gets a numbered name.
/// Answers the path written (or reused), which is granted for reading.
#[tauri::command]
fn write_media_file(
    app: tauri::AppHandle,
    grants: tauri::State<'_, MediaGrants>,
    request: tauri::ipc::Request,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(percent_decode)
    };
    let folder = header("x-folder").ok_or("Missing folder")?;
    let name = header("x-name").and_then(|name| safe_file_name(&name)).ok_or("Missing file name")?;
    if !grants.is_folder_granted(&app, &folder) {
        return Err("not-granted".into());
    }

    let folder_path = std::path::PathBuf::from(&folder);
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (name[..dot].to_string(), name[dot..].to_string()),
        _ => (name.clone(), String::new()),
    };

    for attempt in 1..1000 {
        let candidate = if attempt == 1 {
            folder_path.join(&name)
        } else {
            folder_path.join(format!("{stem} ({attempt}){extension}"))
        };
        match std::fs::metadata(&candidate) {
            Ok(existing) => {
                let same = existing.is_file()
                    && existing.len() == bytes.len() as u64
                    && std::fs::read(&candidate).map(|on_disk| on_disk == *bytes).unwrap_or(false);
                if !same {
                    continue;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                std::fs::write(&candidate, bytes)
                    .map_err(|err| format!("Could not write {}: {err}", candidate.display()))?;
            }
            Err(err) => return Err(err.to_string()),
        }
        let path = candidate.to_string_lossy().to_string();
        grants.grant_files(&app, std::slice::from_ref(&path));
        return Ok(path);
    }
    Err(format!("Too many files named like {name} in {folder}"))
}

/// A file dropped on the editor: grant it, then tell the frontend where it
/// landed so the drop zone under the cursor can take it. Granting happens here,
/// before the event, so the frontend's read cannot race ahead of it.
fn handle_drag_drop(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::{Emitter, Manager};

    let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) = event else {
        return;
    };
    if window.label() != MAIN_WINDOW {
        return;
    }
    let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let app = window.app_handle();
    if let Some(grants) = app.try_state::<MediaGrants>() {
        grants.grant_files(app, &paths);
    }
    let _ = app.emit_to(MAIN_WINDOW, MEDIA_DROP_EVENT, (paths, position.x, position.y));
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
        .plugin(tauri_plugin_dialog::init())
        // Reopen the editor where it was closed: same monitor, position, size
        // and maximized state. Only the editor is tracked — the splash is
        // always centred, and output screens are placed on their monitor by
        // ScreenWindow. VISIBLE is left out because the editor starts hidden
        // and reveal_editor decides when it appears; restoring it here would
        // show a blank editor in front of the splash. A saved position whose
        // monitor is no longer connected is skipped, so the window falls back
        // to the centred default instead of opening off-screen.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_filter(|label| label == MAIN_WINDOW)
                .build(),
        )
        .manage(PendingOpen::new(project_path_from_args()))
        .manage(MediaGrants::new())
        .on_window_event(handle_drag_drop)
        .invoke_handler(tauri::generate_handler![
            take_pending_open,
            read_project_file,
            write_autosave,
            read_autosave,
            clear_autosave,
            pick_media_files,
            pick_media_folder,
            find_media_in_folder,
            read_media_file,
            write_media_file,
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
