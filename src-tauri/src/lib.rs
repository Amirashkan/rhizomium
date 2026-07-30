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
        .invoke_handler(tauri::generate_handler![take_pending_open, read_project_file])
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
