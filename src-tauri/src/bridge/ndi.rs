// NDI, loaded on demand.
//
// NDI is Vizrt's native library; the app does not link it, it loads it the
// first time something asks for NDI (NDI output switched on, a Live Input node
// bound). The Windows installer ships the NDI Runtime's DLL in the app's own
// `ndi` folder (scripts/fetch-ndi-runtime.ps1), so that is normally where it
// comes from; a system-wide NDI Runtime or NDI Tools install is used when the
// app has none of its own (development builds). A machine with neither is a
// normal state, reported as a reason and a download link, and every later
// request tries again — so installing the runtime while the app is open is
// enough, no restart.
//
// Only the handful of calls the app uses are bound: find, receive (video) and
// send (video). Layouts follow the NDI 6 SDK headers (Processing.NDI.*.h).

#![allow(non_camel_case_types, non_snake_case)]

use std::ffi::{c_char, c_float, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

type Instance = *mut c_void;

#[repr(C)]
struct NDIlib_find_create_t {
    show_local_sources: bool,
    p_groups: *const c_char,
    p_extra_ips: *const c_char,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NDIlib_source_t {
    p_ndi_name: *const c_char,
    p_url_address: *const c_char,
}

#[repr(C)]
struct NDIlib_recv_create_v3_t {
    source_to_connect_to: NDIlib_source_t,
    color_format: u32,
    bandwidth: i32,
    allow_video_fields: bool,
    p_ndi_recv_name: *const c_char,
}

#[repr(C)]
struct NDIlib_send_create_t {
    p_ndi_name: *const c_char,
    p_groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
struct NDIlib_video_frame_v2_t {
    xres: c_int,
    yres: c_int,
    FourCC: u32,
    frame_rate_N: c_int,
    frame_rate_D: c_int,
    picture_aspect_ratio: c_float,
    frame_format_type: u32,
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: c_int,
    p_metadata: *const c_char,
    timestamp: i64,
}

impl NDIlib_video_frame_v2_t {
    fn empty() -> Self {
        Self {
            xres: 0,
            yres: 0,
            FourCC: 0,
            frame_rate_N: 0,
            frame_rate_D: 0,
            picture_aspect_ratio: 0.0,
            frame_format_type: 0,
            timecode: 0,
            p_data: ptr::null_mut(),
            line_stride_in_bytes: 0,
            p_metadata: ptr::null(),
            timestamp: 0,
        }
    }
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    (code[0] as u32) | (code[1] as u32) << 8 | (code[2] as u32) << 16 | (code[3] as u32) << 24
}

const FOURCC_RGBA: u32 = fourcc(b"RGBA");
const FOURCC_RGBX: u32 = fourcc(b"RGBX");
const RECV_COLOR_RGBX_RGBA: u32 = 2;
const RECV_BANDWIDTH_HIGHEST: i32 = 100;
const FRAME_TYPE_VIDEO: c_int = 1;
const FRAME_FORMAT_PROGRESSIVE: u32 = 1;
const TIMECODE_SYNTHESIZE: i64 = i64::MAX;

struct Api {
    find_create_v2: unsafe extern "C" fn(*const NDIlib_find_create_t) -> Instance,
    find_destroy: unsafe extern "C" fn(Instance),
    find_get_current_sources: unsafe extern "C" fn(Instance, *mut u32) -> *const NDIlib_source_t,
    recv_create_v3: unsafe extern "C" fn(*const NDIlib_recv_create_v3_t) -> Instance,
    recv_destroy: unsafe extern "C" fn(Instance),
    recv_capture_v3: unsafe extern "C" fn(
        Instance,
        *mut NDIlib_video_frame_v2_t,
        *mut c_void,
        *mut c_void,
        u32,
    ) -> c_int,
    recv_free_video_v2: unsafe extern "C" fn(Instance, *mut NDIlib_video_frame_v2_t),
    send_create: unsafe extern "C" fn(*const NDIlib_send_create_t) -> Instance,
    send_destroy: unsafe extern "C" fn(Instance),
    send_send_video_v2: unsafe extern "C" fn(Instance, *const NDIlib_video_frame_v2_t),
    // Keeps the symbols above valid; never unloaded.
    _library: libloading::Library,
}

/// Where to get the runtime when it is missing.
#[cfg(target_os = "windows")]
pub const RUNTIME_URL: &str = "https://ndi.link/NDIRedistV6";
#[cfg(target_os = "macos")]
pub const RUNTIME_URL: &str = "https://ndi.link/NDIRedistV6Apple";
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub const RUNTIME_URL: &str = "https://ndi.video/for-developers/ndi-sdk/";

#[cfg(target_os = "windows")]
const LIBRARY_NAME: &str = "Processing.NDI.Lib.x64.dll";
#[cfg(target_os = "macos")]
const LIBRARY_NAME: &str = "libndi.dylib";
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const LIBRARY_NAME: &str = "libndi.so.6";

/// The folder the installer put the app's own copy of the runtime in.
static BUNDLED_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Called once at startup with the app's resource folder + `ndi`.
pub fn set_bundled_dir(dir: PathBuf) {
    let _ = BUNDLED_DIR.set(dir);
}

/// Every place the runtime may be, in the order to try them.
fn candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    // The app's own copy first: it is the version this build was made with,
    // and it does not depend on what else is installed.
    if let Some(dir) = BUNDLED_DIR.get() {
        paths.push(dir.join(LIBRARY_NAME));
    }
    for var in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
        if let Some(dir) = std::env::var_os(var) {
            paths.push(PathBuf::from(dir).join(LIBRARY_NAME));
        }
    }
    // The runtime installer sets NDI_RUNTIME_DIR_V6 for processes started
    // after it, not for this one; its default folders cover an install made
    // while the app is open.
    #[cfg(target_os = "windows")]
    {
        let program_files =
            std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into());
        let ndi = PathBuf::from(program_files).join("NDI");
        paths.push(ndi.join("NDI 6 Runtime").join("v6").join(LIBRARY_NAME));
        paths.push(ndi.join("NDI 6 Tools").join("Runtime").join(LIBRARY_NAME));
        paths.push(ndi.join("NDI 6 SDK").join("Bin").join("x64").join(LIBRARY_NAME));
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/usr/local/lib/libndi.dylib"));
        paths.push(PathBuf::from("/Library/NDI SDK for Apple/lib/macOS/libndi.dylib"));
        paths.push(PathBuf::from("/Library/NDI 6 SDK/lib/macOS/libndi.dylib"));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        paths.push(PathBuf::from("/usr/lib/libndi.so.6"));
        paths.push(PathBuf::from("/usr/local/lib/libndi.so.6"));
    }
    // Last, the system's own search path.
    paths.push(PathBuf::from(LIBRARY_NAME));
    paths
}

unsafe fn open(path: &PathBuf) -> Result<Api, String> {
    let library = libloading::Library::new(path).map_err(|e| e.to_string())?;
    macro_rules! sym {
        ($name:literal) => {
            *library
                .get($name)
                .map_err(|e| format!("{} is missing: {e}", String::from_utf8_lossy($name)))?
        };
    }
    let initialize: unsafe extern "C" fn() -> bool = sym!(b"NDIlib_initialize");
    if !initialize() {
        return Err("NDI does not support this computer's CPU".into());
    }
    Ok(Api {
        find_create_v2: sym!(b"NDIlib_find_create_v2"),
        find_destroy: sym!(b"NDIlib_find_destroy"),
        find_get_current_sources: sym!(b"NDIlib_find_get_current_sources"),
        recv_create_v3: sym!(b"NDIlib_recv_create_v3"),
        recv_destroy: sym!(b"NDIlib_recv_destroy"),
        recv_capture_v3: sym!(b"NDIlib_recv_capture_v3"),
        recv_free_video_v2: sym!(b"NDIlib_recv_free_video_v2"),
        send_create: sym!(b"NDIlib_send_create"),
        send_destroy: sym!(b"NDIlib_send_destroy"),
        send_send_video_v2: sym!(b"NDIlib_send_send_video_v2"),
        _library: library,
    })
}

static LOADED: Mutex<Option<&'static Api>> = Mutex::new(None);

/// The NDI library, loading it on first use. A failure is not remembered, so
/// the next call looks again.
fn api() -> Result<&'static Api, String> {
    let mut loaded = LOADED.lock().unwrap();
    if let Some(api) = *loaded {
        return Ok(api);
    }
    // A runtime that is there but will not load (wrong architecture, broken
    // install) is worth naming; the bare-name lookup failing is just "absent".
    let mut broken = None;
    for path in candidates() {
        let explicit = path.components().count() > 1;
        if explicit && !path.exists() {
            continue;
        }
        match unsafe { open(&path) } {
            Ok(api) => {
                let api: &'static Api = Box::leak(Box::new(api));
                *loaded = Some(api);
                return Ok(api);
            }
            Err(err) if explicit => broken = Some(format!("{}: {err}", path.display())),
            Err(_) => {}
        }
    }
    if let Some(err) = broken {
        return Err(format!("The NDI Runtime is installed but could not be loaded ({err})."));
    }
    Err(format!(
        "NDI needs the free NDI Runtime, which is not installed on this computer. \
         Install it from {RUNTIME_URL} — Rhizomium picks it up without a restart."
    ))
}

/// Whether NDI can be used here, and why not when it cannot.
pub fn availability() -> Result<(), String> {
    api().map(|_| ())
}

/// Watches the network for NDI sources.
pub struct Finder {
    api: &'static Api,
    instance: Instance,
}

// NDI instances may be used from any thread (NDI SDK, "Thread safety").
unsafe impl Send for Finder {}

impl Finder {
    pub fn new() -> Result<Self, String> {
        let api = api()?;
        let settings = NDIlib_find_create_t {
            show_local_sources: true,
            p_groups: ptr::null(),
            p_extra_ips: ptr::null(),
        };
        let instance = unsafe { (api.find_create_v2)(&settings) };
        if instance.is_null() {
            return Err("NDI could not start looking for sources".into());
        }
        Ok(Self { api, instance })
    }

    /// Full names ("MACHINE (Source)") of every source seen so far, sorted.
    pub fn sources(&self) -> Vec<String> {
        let mut count = 0u32;
        let list = unsafe { (self.api.find_get_current_sources)(self.instance, &mut count) };
        let mut names = Vec::with_capacity(count as usize);
        for i in 0..count as usize {
            let source = unsafe { *list.add(i) };
            if !source.p_ndi_name.is_null() {
                let name = unsafe { CStr::from_ptr(source.p_ndi_name) };
                names.push(name.to_string_lossy().into_owned());
            }
        }
        names.sort();
        names
    }
}

impl Drop for Finder {
    fn drop(&mut self) {
        unsafe { (self.api.find_destroy)(self.instance) }
    }
}

/// Publishes RGBA frames as one NDI source.
pub struct Sender {
    api: &'static Api,
    instance: Instance,
}

unsafe impl Send for Sender {}

impl Sender {
    pub fn new(name: &str) -> Result<Self, String> {
        let api = api()?;
        let name = CString::new(name).map_err(|_| "the NDI name has a NUL in it".to_string())?;
        // Unclocked: the editor already paces frames to the rate it was asked
        // for, and a clocked send would block this thread on top of that.
        let settings = NDIlib_send_create_t {
            p_ndi_name: name.as_ptr(),
            p_groups: ptr::null(),
            clock_video: false,
            clock_audio: false,
        };
        let instance = unsafe { (api.send_create)(&settings) };
        if instance.is_null() {
            return Err("NDI could not create the output source".into());
        }
        Ok(Self { api, instance })
    }

    /// Send one tightly packed RGBA frame. `data` must be width × height × 4.
    pub fn send(&self, width: u32, height: u32, frame_rate: u32, data: &[u8]) {
        debug_assert_eq!(data.len(), width as usize * height as usize * 4);
        let frame = NDIlib_video_frame_v2_t {
            xres: width as c_int,
            yres: height as c_int,
            FourCC: FOURCC_RGBA,
            frame_rate_N: frame_rate as c_int,
            frame_rate_D: 1,
            picture_aspect_ratio: 0.0,
            frame_format_type: FRAME_FORMAT_PROGRESSIVE,
            timecode: TIMECODE_SYNTHESIZE,
            // NDI only reads a frame it is sent synchronously.
            p_data: data.as_ptr() as *mut u8,
            line_stride_in_bytes: (width * 4) as c_int,
            p_metadata: ptr::null(),
            timestamp: 0,
        };
        unsafe { (self.api.send_send_video_v2)(self.instance, &frame) }
    }
}

impl Drop for Sender {
    fn drop(&mut self) {
        unsafe { (self.api.send_destroy)(self.instance) }
    }
}

/// A running receiver; dropping it stops the thread.
pub struct Receiver {
    stop: Arc<AtomicBool>,
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Called with (width, height, tightly packed RGBA) for each received frame.
pub type OnFrame = Arc<dyn Fn(u32, u32, Vec<u8>) + Send + Sync>;

/// Receive `full_name` on a thread of its own, at most `max_fps` frames a second.
pub fn receive(full_name: &str, max_fps: u32, on_frame: OnFrame) -> Result<Receiver, String> {
    let api = api()?;
    let name = CString::new(full_name).map_err(|_| "bad NDI source name".to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = Arc::clone(&stop);
    let min_interval = Duration::from_secs(1) / max_fps.max(1);

    std::thread::Builder::new()
        .name(format!("ndi-recv {full_name}"))
        .spawn(move || {
            let recv_name = c"Rhizomium Live Input";
            let settings = NDIlib_recv_create_v3_t {
                source_to_connect_to: NDIlib_source_t {
                    p_ndi_name: name.as_ptr(),
                    p_url_address: ptr::null(),
                },
                color_format: RECV_COLOR_RGBX_RGBA,
                bandwidth: RECV_BANDWIDTH_HIGHEST,
                allow_video_fields: false,
                p_ndi_recv_name: recv_name.as_ptr(),
            };
            let instance = unsafe { (api.recv_create_v3)(&settings) };
            if instance.is_null() {
                return;
            }
            let mut last_sent: Option<Instant> = None;
            while !stopping.load(Ordering::Relaxed) {
                let mut video = NDIlib_video_frame_v2_t::empty();
                let kind = unsafe {
                    (api.recv_capture_v3)(instance, &mut video, ptr::null_mut(), ptr::null_mut(), 200)
                };
                if kind != FRAME_TYPE_VIDEO {
                    continue;
                }
                let due = last_sent.map_or(true, |at| at.elapsed() >= min_interval);
                if due {
                    if let Some(pixels) = unsafe { packed_rgba(&video) } {
                        last_sent = Some(Instant::now());
                        on_frame(video.xres as u32, video.yres as u32, pixels);
                    }
                }
                unsafe { (api.recv_free_video_v2)(instance, &mut video) };
            }
            unsafe { (api.recv_destroy)(instance) };
        })
        .map_err(|e| e.to_string())?;

    Ok(Receiver { stop })
}

/// Copy a received RGBA/RGBX frame into tightly packed RGBA, dropping row
/// padding. RGBX's fourth byte is padding, not alpha, so it becomes opaque.
unsafe fn packed_rgba(video: &NDIlib_video_frame_v2_t) -> Option<Vec<u8>> {
    if video.FourCC != FOURCC_RGBA && video.FourCC != FOURCC_RGBX {
        return None;
    }
    let (width, height) = (video.xres as usize, video.yres as usize);
    if width == 0 || height == 0 || video.p_data.is_null() {
        return None;
    }
    let row = width * 4;
    let stride = if video.line_stride_in_bytes > 0 {
        video.line_stride_in_bytes as usize
    } else {
        row
    };
    if stride < row {
        return None;
    }
    let source = std::slice::from_raw_parts(video.p_data, stride * (height - 1) + row);
    let mut pixels = Vec::with_capacity(row * height);
    for y in 0..height {
        pixels.extend_from_slice(&source[y * stride..y * stride + row]);
    }
    if video.FourCC == FOURCC_RGBX {
        for alpha in pixels.iter_mut().skip(3).step_by(4) {
            *alpha = 255;
        }
    }
    Some(pixels)
}

/// The part of an NDI name people recognise: "TouchDesigner" in
/// "STUDIO-PC (TouchDesigner)".
pub fn short_name(full_name: &str) -> &str {
    if full_name.ends_with(')') {
        if let Some(open) = full_name.rfind('(') {
            return full_name[open + 1..full_name.len() - 1].trim();
        }
    }
    full_name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_apps_own_runtime_is_tried_first() {
        set_bundled_dir(PathBuf::from("bundled"));
        assert_eq!(candidates()[0], PathBuf::from("bundled").join(LIBRARY_NAME));
    }

    #[test]
    fn short_names() {
        assert_eq!(short_name("STUDIO-PC (TouchDesigner)"), "TouchDesigner");
        assert_eq!(short_name("plain"), "plain");
    }

    #[test]
    fn repacks_padded_rgbx_as_opaque_rgba() {
        // 2×2 frame, 12-byte stride (4 bytes of padding per row).
        let mut data: Vec<u8> = vec![
            1, 2, 3, 0, 5, 6, 7, 0, 99, 99, 99, 99, //
            9, 10, 11, 0, 13, 14, 15, 0, 99, 99, 99, 99,
        ];
        let mut video = NDIlib_video_frame_v2_t::empty();
        video.xres = 2;
        video.yres = 2;
        video.FourCC = FOURCC_RGBX;
        video.p_data = data.as_mut_ptr();
        video.line_stride_in_bytes = 12;
        let pixels = unsafe { packed_rgba(&video) }.unwrap();
        assert_eq!(
            pixels,
            vec![1, 2, 3, 255, 5, 6, 7, 255, 9, 10, 11, 255, 13, 14, 15, 255]
        );
    }
}
