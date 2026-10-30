// Video in and out: NDI output, Live Input sources, and frames pushed by
// other software — one place, one editor socket (`/video`).
//
// Out: the editor sends its render (src/output/NDIOutput.js) and it goes onto
// the network as an NDI source.
// In: Live Input nodes (src/input/LiveInput.js) subscribe to sources by name
// and get each source's newest frame. A source is either on the network (NDI)
// or pushed here by another program over `/publish` (TouchDesigner, OBS
// scripts, a camera rig), which needs no NDI at all.
//
// Nothing runs until it is used: NDI is loaded when an editor connects, the
// network is searched only while a Live Input node is subscribed, a source is
// received only while subscribed to, and the NDI output exists only while
// frames are being sent.
//
// Editor protocol:
//   bridge → editor
//     {"type": "welcome", "ndi_available", "ndi_error", "ndi_runtime_url",
//      "sources", "source_name", ...}
//     {"type": "sources", "sources": [...], "ndi_available", "ndi_error"}
//     {"type": "status", ...output state...}
//     {"type": "frame", "source", "width", "height", "format"} then the bytes
//     {"type": "error", "message"}
//   editor → bridge
//     {"type": "subscribe" | "unsubscribe", "source": name}
//     {"type": "frame", "width", "height", "format": "rgba"} then the bytes
//     {"type": "set_source_name", "name"}, {"type": "set_frame_rate", "fps"}
//
// Publishers: ws `/publish/<name>` (or `/publish` and `/` with a first
// {"type": "hello", "name"}), sending JPEG/PNG per message or a raw RGBA
// header then bytes; or POST `/publish/<name>` with one JPEG/PNG body.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::ndi;

const BYTES_PER_PIXEL: usize = 4;

/// A frame header names an allocation, so it needs a ceiling even on a
/// loopback socket. 8192×8192 is past any real output.
pub const MAX_FRAME_PIXELS: usize = 8192 * 8192;

/// An encoded frame has no header to bound it, so bound the message instead.
pub const MAX_ENCODED_BYTES: usize = 64 * 1024 * 1024;

const MAX_STREAM_NAME: usize = 128;
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(2);
/// A pushed stream gone quiet this long leaves the list, so a closed
/// TouchDesigner project does not linger as a source.
const STREAM_EXPIRY: Duration = Duration::from_secs(10);
const MAX_RECEIVE_FPS: u32 = 60;
pub const DEFAULT_SOURCE_NAME: &str = "Rhizomium";
const DEFAULT_FRAME_RATE: u32 = 30;

const JPEG_MAGIC: &[u8] = b"\xff\xd8\xff";
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Clone)]
struct Frame {
    width: u32,
    height: u32,
    format: &'static str,
    data: Bytes,
    seq: u64,
}

/// Raw RGBA header from an editor or publisher, already checked.
#[derive(Clone, Copy)]
struct RawHeader {
    width: u32,
    height: u32,
}

/// The NDI output, running on a thread of its own so a slow send never holds
/// up the editor's socket. Dropping it closes the source.
struct Output {
    frames: SyncSender<(u32, u32, Bytes)>,
}

struct OutputConfig {
    name: String,
    frame_rate: u32,
    sending: bool,
    error: Option<String>,
}

struct Editor {
    subscriptions: HashSet<String>,
    outbox: mpsc::UnboundedSender<Message>,
    sends_output: bool,
}

#[derive(Default)]
struct State {
    editors: HashMap<u64, Editor>,
    /// Newest frame per source key: "stream:<name>" or "ndi:<full name>".
    frames: HashMap<String, Frame>,
    stream_seen: HashMap<String, Instant>,
    seq: u64,
    ndi_sources: Vec<String>,
    ndi_error: Option<String>,
    receivers: HashMap<String, ndi::Receiver>,
    finder: Option<ndi::Finder>,
    discovery: Option<JoinHandle<()>>,
    output: Option<Output>,
}

pub struct VideoHub {
    state: Mutex<State>,
    output_config: Arc<Mutex<OutputConfig>>,
    /// Bumped on every new frame (and on subscribe), waking editor pumps.
    tick: watch::Sender<u64>,
    next_id: AtomicU64,
}

pub fn sniff_image_format(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(JPEG_MAGIC) {
        Some("jpeg")
    } else if data.starts_with(PNG_MAGIC) {
        Some("png")
    } else {
        None
    }
}

pub fn clean_stream_name(name: Option<&str>) -> Option<String> {
    let name = name?.trim();
    if name.is_empty() || name.chars().count() > MAX_STREAM_NAME || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.to_string())
}

/// Check a raw RGBA frame header, returning why it is unusable.
fn raw_header(data: &Value) -> Result<RawHeader, String> {
    let (Some(width), Some(height)) = (
        data.get("width").and_then(Value::as_u64),
        data.get("height").and_then(Value::as_u64),
    ) else {
        return Err("frame header is missing an integer width and height".into());
    };
    if width == 0 || height == 0 {
        return Err(format!("frame size {width}×{height} is not positive"));
    }
    if (width as usize).saturating_mul(height as usize) > MAX_FRAME_PIXELS {
        return Err(format!("frame size {width}×{height} is larger than accepted"));
    }
    let format = data.get("format").and_then(Value::as_str).unwrap_or("rgba");
    if format != "rgba" {
        return Err(format!("unsupported pixel format {format:?} — send RGBA"));
    }
    Ok(RawHeader { width: width as u32, height: height as u32 })
}

fn text(value: Value) -> Message {
    Message::Text(value.to_string().into())
}

impl VideoHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            output_config: Arc::new(Mutex::new(OutputConfig {
                name: DEFAULT_SOURCE_NAME.into(),
                frame_rate: DEFAULT_FRAME_RATE,
                sending: false,
                error: None,
            })),
            tick: watch::channel(0).0,
            next_id: AtomicU64::new(0),
        })
    }

    // ------------------------------------------------------------------
    // Sources
    // ------------------------------------------------------------------

    fn put(&self, key: String, width: u32, height: u32, format: &'static str, data: Bytes) {
        let seq = {
            let mut state = self.state.lock().unwrap();
            state.seq += 1;
            let seq = state.seq;
            if key.starts_with("stream:") {
                state.stream_seen.insert(key.clone(), Instant::now());
            }
            state.frames.insert(key, Frame { width, height, format, data, seq });
            seq
        };
        self.tick.send_replace(seq);
    }

    fn list_sources(state: &State) -> Value {
        let mut streams: Vec<&str> = state
            .frames
            .keys()
            .filter_map(|key| key.strip_prefix("stream:"))
            .collect();
        streams.sort();
        let mut sources: Vec<Value> =
            streams.into_iter().map(|name| json!({ "name": name, "kind": "stream" })).collect();
        for name in &state.ndi_sources {
            sources.push(json!({ "name": name, "short_name": ndi::short_name(name), "kind": "ndi" }));
        }
        Value::Array(sources)
    }

    fn sources_message(state: &State) -> Value {
        json!({
            "type": "sources",
            "sources": Self::list_sources(state),
            "ndi_available": state.ndi_error.is_none(),
            "ndi_error": state.ndi_error,
            "ndi_runtime_url": ndi::RUNTIME_URL,
        })
    }

    fn broadcast(state: &State, message: Message) {
        for editor in state.editors.values() {
            let _ = editor.outbox.send(message.clone());
        }
    }

    /// The frame key a subscription name means right now. Pushed streams win
    /// over NDI; NDI matches the full name, then the part in brackets, then
    /// any part of it.
    fn resolve(state: &State, wanted: &str) -> Option<String> {
        let exact = format!("stream:{wanted}");
        if state.frames.contains_key(&exact) {
            return Some(exact);
        }
        let lowered = wanted.to_lowercase();
        if let Some(key) = state.frames.keys().find(|key| {
            key.strip_prefix("stream:").is_some_and(|name| name.to_lowercase() == lowered)
        }) {
            return Some(key.clone());
        }
        let ndi = &state.ndi_sources;
        ndi.iter()
            .find(|name| *name == wanted)
            .or_else(|| ndi.iter().find(|name| ndi::short_name(name).to_lowercase() == lowered))
            .or_else(|| ndi.iter().find(|name| name.to_lowercase().contains(&lowered)))
            .map(|name| format!("ndi:{name}"))
    }

    /// Run exactly the NDI receivers some editor is subscribed to.
    fn sync_receivers(self: &Arc<Self>, state: &mut State) {
        let wanted: HashSet<String> = state
            .editors
            .values()
            .flat_map(|editor| editor.subscriptions.iter())
            .filter_map(|name| Self::resolve(state, name))
            .filter_map(|key| key.strip_prefix("ndi:").map(str::to_string))
            .collect();
        let stale: Vec<String> =
            state.receivers.keys().filter(|name| !wanted.contains(*name)).cloned().collect();
        for name in stale {
            state.receivers.remove(&name);
            state.frames.remove(&format!("ndi:{name}"));
        }
        for name in wanted {
            if state.receivers.contains_key(&name) {
                continue;
            }
            let hub = Arc::downgrade(self);
            let key = format!("ndi:{name}");
            let on_frame: ndi::OnFrame = Arc::new(move |width, height, pixels| {
                if let Some(hub) = hub.upgrade() {
                    hub.put(key.clone(), width, height, "rgba", Bytes::from(pixels));
                }
            });
            match ndi::receive(&name, MAX_RECEIVE_FPS, on_frame) {
                Ok(receiver) => {
                    state.receivers.insert(name, receiver);
                }
                Err(err) => state.ndi_error = Some(err),
            }
        }
    }

    fn wants_discovery(state: &State) -> bool {
        state.editors.values().any(|editor| !editor.subscriptions.is_empty())
    }

    /// Search the network and expire quiet streams while any Live Input is
    /// subscribed; stop (and let go of NDI) when none is.
    fn ensure_discovery(self: &Arc<Self>, state: &mut State) {
        if state.discovery.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        let hub = Arc::clone(self);
        state.discovery = Some(tokio::spawn(async move {
            loop {
                let searching = {
                    let mut state = hub.state.lock().unwrap();
                    if !Self::wants_discovery(&state) {
                        state.finder = None;
                        state.ndi_sources.clear();
                        state.receivers.clear();
                        state.discovery = None;
                        return;
                    }
                    if state.finder.is_none() {
                        match ndi::Finder::new() {
                            Ok(finder) => {
                                state.finder = Some(finder);
                                state.ndi_error = None;
                            }
                            Err(err) => state.ndi_error = Some(err),
                        }
                    }
                    state.finder.is_some()
                };

                let found = if searching {
                    let hub = Arc::clone(&hub);
                    tokio::task::spawn_blocking(move || {
                        hub.state.lock().unwrap().finder.as_ref().map(ndi::Finder::sources)
                    })
                    .await
                    .ok()
                    .flatten()
                } else {
                    None
                };

                {
                    let mut state = hub.state.lock().unwrap();
                    let mut changed = false;
                    let now = Instant::now();
                    let expired: Vec<String> = state
                        .stream_seen
                        .iter()
                        .filter(|(_, seen)| now.duration_since(**seen) > STREAM_EXPIRY)
                        .map(|(key, _)| key.clone())
                        .collect();
                    for key in expired {
                        state.stream_seen.remove(&key);
                        state.frames.remove(&key);
                        changed = true;
                    }
                    if let Some(found) = found {
                        if found != state.ndi_sources {
                            state.ndi_sources = found;
                            changed = true;
                        }
                    }
                    hub.sync_receivers(&mut state);
                    if changed {
                        Self::broadcast(&state, text(Self::sources_message(&state)));
                    }
                }
                tokio::time::sleep(DISCOVERY_INTERVAL).await;
            }
        }));
    }

    // ------------------------------------------------------------------
    // Output
    // ------------------------------------------------------------------

    fn output_status(&self, kind: &str, state: &State) -> Value {
        let config = self.output_config.lock().unwrap();
        json!({
            "type": kind,
            "server_version": env!("CARGO_PKG_VERSION"),
            "ndi_available": state.ndi_error.is_none() && config.error.is_none(),
            "ndi_error": config.error.clone().or_else(|| state.ndi_error.clone()),
            "ndi_runtime_url": ndi::RUNTIME_URL,
            "ndi_sending": config.sending,
            "source_name": config.name,
            "frame_rate": config.frame_rate,
            "sources": Self::list_sources(state),
        })
    }

    fn start_output(&self) -> Output {
        let (frames, incoming) = sync_channel::<(u32, u32, Bytes)>(1);
        let config = Arc::clone(&self.output_config);
        std::thread::spawn(move || {
            let mut sender: Option<(ndi::Sender, String)> = None;
            while let Ok((width, height, data)) = incoming.recv() {
                let (name, rate) = {
                    let config = config.lock().unwrap();
                    (config.name.clone(), config.frame_rate)
                };
                // A rename means re-announcing on the network.
                if sender.as_ref().is_some_and(|(_, current)| *current != name) {
                    sender = None;
                }
                if sender.is_none() {
                    match ndi::Sender::new(&name) {
                        Ok(created) => sender = Some((created, name)),
                        Err(err) => {
                            let mut config = config.lock().unwrap();
                            config.error = Some(err);
                            config.sending = false;
                            continue;
                        }
                    }
                }
                if let Some((sender, _)) = &sender {
                    sender.send(width, height, rate, &data);
                    let mut config = config.lock().unwrap();
                    config.sending = true;
                    config.error = None;
                }
            }
            config.lock().unwrap().sending = false;
        });
        Output { frames }
    }

    fn send_output(&self, state: &mut State, header: RawHeader, data: Bytes) -> Result<(), String> {
        let expected = header.width as usize * header.height as usize * BYTES_PER_PIXEL;
        if data.len() != expected {
            return Err(format!(
                "frame said {}×{} ({expected} bytes) but carried {}",
                header.width,
                header.height,
                data.len()
            ));
        }
        if state.output.is_none() {
            state.output = Some(self.start_output());
        }
        let output = state.output.as_ref().unwrap();
        // Busy sending the last one: skip this frame rather than queue it.
        // Late video is worse than missing video on a live output.
        match output.frames.try_send((header.width, header.height, data)) {
            Ok(()) | Err(TrySendError::Full(_)) => Ok(()),
            Err(TrySendError::Disconnected(_)) => {
                state.output = None;
                Ok(())
            }
        }
    }

    // ------------------------------------------------------------------
    // Editor connection
    // ------------------------------------------------------------------

    pub async fn serve_editor(self: Arc<Self>, socket: WebSocket) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (outbox, mut outgoing) = mpsc::unbounded_channel::<Message>();

        // Loading NDI touches the disk; keep it off the async workers.
        let ndi_error = tokio::task::spawn_blocking(ndi::availability).await.ok().and_then(Result::err);

        let welcome = {
            let mut state = self.state.lock().unwrap();
            state.ndi_error = ndi_error;
            state.editors.insert(
                id,
                Editor { subscriptions: HashSet::new(), outbox: outbox.clone(), sends_output: false },
            );
            self.output_status("welcome", &state)
        };
        let _ = outbox.send(text(welcome));

        let (mut sink, mut source) = socket.split();
        let hub = Arc::clone(&self);
        let mut ticks = self.tick.subscribe();
        let writer = tokio::spawn(async move {
            let mut sent: HashMap<String, u64> = HashMap::new();
            loop {
                tokio::select! {
                    message = outgoing.recv() => {
                        let Some(message) = message else { return };
                        if sink.send(message).await.is_err() {
                            return;
                        }
                    }
                    changed = ticks.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        // Newest frame of each subscribed source this editor
                        // has not had yet. Awaiting each send is the
                        // backpressure: frames that arrive meanwhile replace
                        // each other and only the latest goes next.
                        let due: Vec<(String, Frame)> = {
                            let state = hub.state.lock().unwrap();
                            let Some(editor) = state.editors.get(&id) else { return };
                            editor
                                .subscriptions
                                .iter()
                                .filter_map(|name| {
                                    let key = Self::resolve(&state, name)?;
                                    let frame = state.frames.get(&key)?;
                                    (sent.get(name) != Some(&frame.seq)).then(|| (name.clone(), frame.clone()))
                                })
                                .collect()
                        };
                        for (name, frame) in due {
                            sent.insert(name.clone(), frame.seq);
                            let header = json!({
                                "type": "frame",
                                "source": name,
                                "width": frame.width,
                                "height": frame.height,
                                "format": frame.format,
                            });
                            if sink.send(text(header)).await.is_err()
                                || sink.send(Message::Binary(frame.data)).await.is_err()
                            {
                                return;
                            }
                        }
                    }
                }
            }
        });

        let mut pending: Option<RawHeader> = None;
        while let Some(Ok(message)) = source.next().await {
            match message {
                Message::Text(raw) => {
                    let Ok(data) = serde_json::from_str::<Value>(raw.as_str()) else { continue };
                    pending = None;
                    self.handle_editor_text(id, &outbox, &data, &mut pending);
                }
                Message::Binary(bytes) => {
                    let Some(header) = pending.take() else { continue };
                    let mut state = self.state.lock().unwrap();
                    if let Err(problem) = self.send_output(&mut state, header, bytes) {
                        let _ = outbox.send(text(json!({ "type": "error", "message": problem })));
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        writer.abort();
        let mut state = self.state.lock().unwrap();
        state.editors.remove(&id);
        // The NDI source stops with the last editor sending to it, so a
        // closed window does not leave a frozen frame on the network.
        if !state.editors.values().any(|editor| editor.sends_output) {
            state.output = None;
        }
        self.sync_receivers(&mut state);
    }

    fn handle_editor_text(
        self: &Arc<Self>,
        id: u64,
        outbox: &mpsc::UnboundedSender<Message>,
        data: &Value,
        pending: &mut Option<RawHeader>,
    ) {
        let kind = data.get("type").and_then(Value::as_str).unwrap_or("");
        let mut state = self.state.lock().unwrap();
        match kind {
            "subscribe" | "unsubscribe" => {
                let Some(name) = clean_stream_name(data.get("source").and_then(Value::as_str)) else {
                    return;
                };
                let Some(editor) = state.editors.get_mut(&id) else { return };
                if kind == "subscribe" {
                    editor.subscriptions.insert(name);
                } else {
                    editor.subscriptions.remove(&name);
                }
                self.sync_receivers(&mut state);
                if kind == "subscribe" {
                    self.ensure_discovery(&mut state);
                    // Hand over a frame already waiting rather than leave a
                    // still source black until it next changes.
                    drop(state);
                    self.tick.send_modify(|_| {});
                }
            }
            "list_sources" => {
                let _ = outbox.send(text(Self::sources_message(&state)));
            }
            "frame" => {
                if let Some(editor) = state.editors.get_mut(&id) {
                    editor.sends_output = true;
                }
                match raw_header(data) {
                    Ok(header) => *pending = Some(header),
                    Err(problem) => {
                        let _ = outbox.send(text(json!({ "type": "error", "message": problem })));
                    }
                }
            }
            "set_source_name" => {
                let name = data.get("name").and_then(Value::as_str).unwrap_or("").trim();
                if name.is_empty() || name.len() > 64 {
                    return;
                }
                if let Some(editor) = state.editors.get_mut(&id) {
                    editor.sends_output = true;
                }
                self.output_config.lock().unwrap().name = name.to_string();
                Self::broadcast(&state, text(self.output_status("status", &state)));
            }
            "set_frame_rate" => {
                let Some(fps) = data.get("fps").and_then(Value::as_f64) else { return };
                if !(1.0..=240.0).contains(&fps) {
                    return;
                }
                self.output_config.lock().unwrap().frame_rate = fps.round() as u32;
                Self::broadcast(&state, text(self.output_status("status", &state)));
            }
            "ping" => {
                let _ = outbox.send(text(json!({ "type": "pong" })));
            }
            _ => {}
        }
    }

    // ------------------------------------------------------------------
    // Publishers
    // ------------------------------------------------------------------

    /// Take one JPEG/PNG frame for `name`. Returns why it was refused.
    pub fn accept_encoded(&self, name: &str, data: Bytes) -> Result<(), String> {
        let format = sniff_image_format(&data).ok_or(
            "binary frames must be JPEG or PNG, or follow a raw RGBA frame header",
        )?;
        if data.len() > MAX_ENCODED_BYTES {
            return Err("frame is larger than accepted".into());
        }
        self.put_stream(name, 0, 0, format, data);
        Ok(())
    }

    fn accept_raw(&self, name: &str, header: RawHeader, data: Bytes) -> Result<(), String> {
        let expected = header.width as usize * header.height as usize * BYTES_PER_PIXEL;
        if data.len() != expected {
            return Err(format!(
                "frame said {}×{} ({expected} bytes) but carried {}",
                header.width,
                header.height,
                data.len()
            ));
        }
        self.put_stream(name, header.width, header.height, "rgba", data);
        Ok(())
    }

    fn put_stream(&self, name: &str, width: u32, height: u32, format: &'static str, data: Bytes) {
        let key = format!("stream:{name}");
        let is_new = !self.state.lock().unwrap().frames.contains_key(&key);
        // Dimensions of an encoded frame are the editor's to find when it
        // decodes; 0 says so.
        self.put(key, width, height, format, data);
        if is_new {
            let state = self.state.lock().unwrap();
            Self::broadcast(&state, text(Self::sources_message(&state)));
        }
    }

    pub async fn serve_publisher(self: Arc<Self>, socket: WebSocket, mut name: Option<String>) {
        let (mut sink, mut source) = socket.split();
        let mut pending: Option<RawHeader> = None;
        while let Some(Ok(message)) = source.next().await {
            let problem = match message {
                Message::Text(raw) => {
                    let data: Value = serde_json::from_str(raw.as_str()).unwrap_or(Value::Null);
                    match data.get("type").and_then(Value::as_str) {
                        Some("hello") => match clean_stream_name(data.get("name").and_then(Value::as_str)) {
                            Some(named) => {
                                name = Some(named);
                                None
                            }
                            None => Some("hello needs a name".to_string()),
                        },
                        _ if name.is_none() => Some(r#"send {"type": "hello", "name": "..."} first"#.into()),
                        Some("frame") => match raw_header(&data) {
                            Ok(header) => {
                                pending = Some(header);
                                None
                            }
                            Err(problem) => {
                                pending = None;
                                Some(problem)
                            }
                        },
                        _ => None,
                    }
                }
                Message::Binary(bytes) => match (&name, pending.take()) {
                    (None, _) => Some(r#"send {"type": "hello", "name": "..."} first"#.into()),
                    (Some(name), Some(header)) => self.accept_raw(name, header, bytes).err(),
                    (Some(name), None) => self.accept_encoded(name, bytes).err(),
                },
                Message::Close(_) => break,
                _ => None,
            };
            if let Some(problem) = problem {
                if sink.send(text(json!({ "type": "error", "message": problem }))).await.is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_and_cleans() {
        assert_eq!(sniff_image_format(b"\xff\xd8\xff\xe0rest"), Some("jpeg"));
        assert_eq!(sniff_image_format(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff_image_format(b"GIF89a"), None);
        assert_eq!(clean_stream_name(Some("  td  ")).as_deref(), Some("td"));
        assert_eq!(clean_stream_name(Some("")), None);
        assert_eq!(clean_stream_name(Some("a\nb")), None);
        assert_eq!(clean_stream_name(Some(&"x".repeat(129))), None);
    }

    #[test]
    fn checks_raw_headers() {
        assert!(raw_header(&json!({ "width": 2, "height": 2 })).is_ok());
        assert!(raw_header(&json!({ "width": 0, "height": 2 })).is_err());
        assert!(raw_header(&json!({ "width": 2, "height": 2, "format": "bgra" })).is_err());
        assert!(raw_header(&json!({ "width": 100000, "height": 100000 })).is_err());
    }

    #[test]
    fn resolves_streams_before_ndi_and_short_names() {
        let mut state = State {
            ndi_sources: vec!["STUDIO (TouchDesigner)".into(), "STUDIO (OBS)".into()],
            ..State::default()
        };
        state.frames.insert(
            "stream:obs".into(),
            Frame { width: 0, height: 0, format: "png", data: Bytes::new(), seq: 1 },
        );
        assert_eq!(VideoHub::resolve(&state, "OBS").as_deref(), Some("stream:obs"));
        assert_eq!(
            VideoHub::resolve(&state, "touchdesigner").as_deref(),
            Some("ndi:STUDIO (TouchDesigner)")
        );
        assert_eq!(VideoHub::resolve(&state, "nothing"), None);
    }
}
