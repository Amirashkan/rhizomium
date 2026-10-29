// Built-in OSC bridge.
//
// OSC arrives over UDP and no webview can open a UDP socket, so the editor
// hears OSC through a bridge that owns the UDP port and forwards each datagram,
// byte for byte, over a WebSocket. On the web and in development that bridge is
// osc_bridge_server.py; the installed app cannot count on Python being there,
// so it runs this port of it instead, started with the app. Same protocol, so
// the editor (src/osc/OSCManager.js) cannot tell the two apart:
//
//   - On connect the bridge sends one JSON `welcome` with its UDP state.
//   - Every OSC datagram after that is a binary WebSocket frame.
//   - `{"type": "set_udp_port", "port": N}` from the editor moves the UDP
//     socket; every client then gets a JSON `status`.
//
// When something already holds the WebSocket port — the Python bridge started
// by `npm run tauri:dev`, or a second copy of the app — this bridge stays out
// of the way: that one serves the editor just as well.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

/// WebSocket port the editor connects to (OSC_BRIDGE_PORT in OSCManager.js).
pub const WS_PORT: u16 = 8767;
/// The usual OSC convention; the editor can move it.
pub const DEFAULT_UDP_PORT: u16 = 9000;

/// WebSocket side is loopback-only: only the editor on this machine may read
/// the stream. UDP is all interfaces, because driving the editor from a phone
/// or tablet running TouchOSC is the point of the feature.
const WS_HOST: &str = "127.0.0.1";
const UDP_HOST: &str = "0.0.0.0";

/// Per-client queue depth. Control data is only worth delivering while it is
/// current, so a backed-up client loses its oldest packets rather than
/// stalling the UDP receiver or growing without bound.
const CLIENT_QUEUE_SIZE: usize = 256;

/// How often to retry a busy UDP port, so the bridge recovers by itself once
/// the other application lets go of it.
const UDP_RETRY: Duration = Duration::from_secs(3);

/// Origins the editor is served from. Any page in the user's browser could
/// otherwise open this socket and watch their control surface; clients that
/// send no Origin (scripts, native tools) are let through, as in the Python
/// bridge.
const ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
];

enum Outgoing {
    Packet(Vec<u8>),
    Text(String),
}

/// One editor connection's pending messages, oldest dropped on overflow.
struct ClientQueue {
    items: Mutex<VecDeque<Outgoing>>,
    ready: Notify,
}

impl ClientQueue {
    fn new() -> Self {
        Self {
            items: Mutex::new(VecDeque::with_capacity(CLIENT_QUEUE_SIZE)),
            ready: Notify::new(),
        }
    }

    fn push(&self, item: Outgoing) {
        let mut items = self.items.lock().unwrap();
        if items.len() >= CLIENT_QUEUE_SIZE {
            items.pop_front();
        }
        items.push_back(item);
        drop(items);
        self.ready.notify_one();
    }

    async fn pop(&self) -> Outgoing {
        loop {
            if let Some(item) = self.items.lock().unwrap().pop_front() {
                return item;
            }
            self.ready.notified().await;
        }
    }
}

struct UdpState {
    port: u16,
    /// Why the UDP socket is not open, if it is not — reported to the editor so
    /// the panel can name the real problem instead of guessing.
    error: Option<String>,
    receiver: Option<JoinHandle<()>>,
    retry: Option<JoinHandle<()>>,
}

pub struct Bridge {
    udp: tokio::sync::Mutex<UdpState>,
    clients: Mutex<Vec<(u64, Arc<ClientQueue>)>>,
    next_client: AtomicU64,
}

impl Bridge {
    fn new(udp_port: u16) -> Arc<Self> {
        Arc::new(Self {
            udp: tokio::sync::Mutex::new(UdpState {
                port: udp_port,
                error: None,
                receiver: None,
                retry: None,
            }),
            clients: Mutex::new(Vec::new()),
            next_client: AtomicU64::new(0),
        })
    }

    fn status(kind: &str, udp: &UdpState) -> String {
        json!({
            "type": kind,
            "server_version": env!("CARGO_PKG_VERSION"),
            "udp_host": UDP_HOST,
            "udp_port": udp.port,
            "udp_listening": udp.receiver.is_some(),
            "udp_error": udp.error,
        })
        .to_string()
    }

    fn broadcast(&self, item: impl Fn() -> Outgoing) {
        for (_, queue) in self.clients.lock().unwrap().iter() {
            queue.push(item());
        }
    }

    fn busy_message(port: u16, err: &std::io::Error) -> String {
        format!(
            "Could not listen on UDP {UDP_HOST}:{port} — {err}. \
             Another application is probably using that port."
        )
    }

    /// Start forwarding datagrams from `socket`, replacing any earlier one.
    fn install(self: &Arc<Self>, udp: &mut UdpState, socket: UdpSocket, port: u16) {
        if let Some(old) = udp.receiver.take() {
            old.abort();
        }
        let bridge = Arc::clone(self);
        udp.receiver = Some(tokio::spawn(async move {
            let mut buf = vec![0u8; 65536];
            loop {
                match socket.recv_from(&mut buf).await {
                    Ok((len, _)) => {
                        let packet = &buf[..len];
                        bridge.broadcast(|| Outgoing::Packet(packet.to_vec()));
                    }
                    // Windows reports ICMP "port unreachable" from an earlier
                    // send as a recv error; nothing to do but keep listening.
                    Err(_) => continue,
                }
            }
        }));
        udp.port = port;
        udp.error = None;
    }

    /// Open the UDP socket, recording rather than failing on a busy port.
    async fn bind_udp(self: &Arc<Self>) {
        let mut udp = self.udp.lock().await;
        let port = udp.port;
        match UdpSocket::bind((UDP_HOST, port)).await {
            Ok(socket) => self.install(&mut udp, socket, port),
            Err(err) => {
                udp.error = Some(Self::busy_message(port, &err));
                self.start_retrying(&mut udp);
            }
        }
    }

    fn start_retrying(self: &Arc<Self>, udp: &mut UdpState) {
        if udp.retry.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        let bridge = Arc::clone(self);
        udp.retry = Some(tokio::spawn(async move {
            loop {
                tokio::time::sleep(UDP_RETRY).await;
                let mut udp = bridge.udp.lock().await;
                if udp.receiver.is_some() {
                    return;
                }
                let port = udp.port;
                if let Ok(socket) = UdpSocket::bind((UDP_HOST, port)).await {
                    bridge.install(&mut udp, socket, port);
                    let status = Self::status("status", &udp);
                    bridge.broadcast(|| Outgoing::Text(status.clone()));
                    return;
                }
            }
        }));
    }

    /// Move to `port` at the editor's request.
    ///
    /// The new port is opened before the old one is released, so a refused
    /// request leaves a working bridge where it was.
    async fn set_udp_port(self: &Arc<Self>, port: u16) {
        let mut udp = self.udp.lock().await;
        if port == udp.port && udp.receiver.is_some() {
            return;
        }
        match UdpSocket::bind((UDP_HOST, port)).await {
            Ok(socket) => {
                if let Some(retry) = udp.retry.take() {
                    retry.abort();
                }
                self.install(&mut udp, socket, port);
            }
            Err(err) => {
                udp.error = Some(Self::busy_message(port, &err));
                // Only retry when there is no working socket to fall back on.
                if udp.receiver.is_none() {
                    udp.port = port;
                    self.start_retrying(&mut udp);
                }
            }
        }
        let status = Self::status("status", &udp);
        self.broadcast(|| Outgoing::Text(status.clone()));
    }

    async fn handle_control(self: &Arc<Self>, queue: &ClientQueue, text: &str) {
        let Ok(data) = serde_json::from_str::<Value>(text) else {
            return;
        };
        if data.get("type").and_then(Value::as_str) != Some("set_udp_port") {
            return;
        }
        match parse_port(data.get("port")) {
            Some(port) => self.set_udp_port(port).await,
            None => {
                let udp = self.udp.lock().await;
                let mut status: Value = serde_json::from_str(&Self::status("status", &udp)).unwrap();
                status["udp_error"] = json!(format!("Invalid UDP port requested: {}", data["port"]));
                queue.push(Outgoing::Text(status.to_string()));
            }
        }
    }

    async fn serve_client(self: Arc<Self>, stream: TcpStream) {
        let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, check_handshake).await else {
            return;
        };
        let (mut sink, mut source) = socket.split();

        let queue = Arc::new(ClientQueue::new());
        // Welcome first, then join the fan-out, so it is always the first frame.
        queue.push(Outgoing::Text(Self::status("welcome", &*self.udp.lock().await)));
        let id = self.next_client.fetch_add(1, Ordering::Relaxed);
        self.clients.lock().unwrap().push((id, Arc::clone(&queue)));

        let writer_queue = Arc::clone(&queue);
        let writer = tokio::spawn(async move {
            loop {
                let message = match writer_queue.pop().await {
                    Outgoing::Packet(bytes) => Message::Binary(bytes.into()),
                    Outgoing::Text(text) => Message::Text(text.into()),
                };
                if sink.send(message).await.is_err() {
                    return;
                }
            }
        });

        while let Some(Ok(message)) = source.next().await {
            match message {
                Message::Text(text) => self.handle_control(&queue, text.as_str()).await,
                Message::Close(_) => break,
                _ => {}
            }
        }

        self.clients.lock().unwrap().retain(|(client, _)| *client != id);
        writer.abort();
    }
}

/// Only `/ws`, and only from the editor's origins (or no Origin at all).
#[allow(clippy::result_large_err)] // the error type is tungstenite's callback signature
fn check_handshake(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    if request.uri().path() != "/ws" {
        return Err(refuse(StatusCode::NOT_FOUND, "not found"));
    }
    match request.headers().get("origin") {
        Some(origin) if !origin_allowed(origin.to_str().unwrap_or("")) => {
            Err(refuse(StatusCode::FORBIDDEN, "origin not allowed"))
        }
        _ => Ok(response),
    }
}

fn refuse(status: StatusCode, reason: &str) -> ErrorResponse {
    let mut response = ErrorResponse::new(Some(reason.to_string()));
    *response.status_mut() = status;
    response
}

fn origin_allowed(origin: &str) -> bool {
    ALLOWED_ORIGINS.contains(&origin)
}

/// A UDP port from the editor's request: an integer (or integer string, as the
/// Python bridge's `int()` accepts) in 1..=65535.
fn parse_port(value: Option<&Value>) -> Option<u16> {
    let port = match value? {
        Value::Number(n) => n.as_u64()?,
        Value::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    u16::try_from(port).ok().filter(|p| *p != 0)
}

/// Run the bridge until the app exits. Returns early, having done nothing,
/// when the WebSocket port is already taken.
pub async fn run(ws_port: u16, udp_port: u16) {
    let listener = match TcpListener::bind((WS_HOST, ws_port)).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!(
                "OSC bridge: ws://{WS_HOST}:{ws_port} is in use ({err}); \
                 leaving OSC to whatever holds it"
            );
            return;
        }
    };
    let bridge = Bridge::new(udp_port);
    bridge.bind_udp().await;

    loop {
        if let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(Arc::clone(&bridge).serve_client(stream));
        }
    }
}

/// Start the bridge on Tauri's async runtime.
pub fn start() {
    tauri::async_runtime::spawn(run(WS_PORT, DEFAULT_UDP_PORT));
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn free_udp_port() -> u16 {
        std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    async fn connect(
        ws_port: u16,
        origin: Option<&str>,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        tokio_tungstenite::tungstenite::Error,
    > {
        let mut request = format!("ws://127.0.0.1:{ws_port}/ws").into_client_request().unwrap();
        if let Some(origin) = origin {
            request.headers_mut().insert("origin", origin.parse().unwrap());
        }
        for _ in 0..50 {
            match tokio_tungstenite::connect_async(request.clone()).await {
                Err(tokio_tungstenite::tungstenite::Error::Io(_)) => {
                    tokio::time::sleep(Duration::from_millis(20)).await
                }
                other => return other.map(|(socket, _)| socket),
            }
        }
        panic!("bridge never came up");
    }

    async fn next_json<S>(socket: &mut S) -> Value
    where
        S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                return serde_json::from_str(text.as_str()).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn welcomes_the_desktop_origin_and_forwards_datagrams() {
        let (ws_port, udp_port) = (free_port(), free_udp_port());
        tokio::spawn(run(ws_port, udp_port));

        let mut socket = connect(ws_port, Some("http://tauri.localhost")).await.unwrap();
        let welcome = next_json(&mut socket).await;
        assert_eq!(welcome["type"], "welcome");
        assert_eq!(welcome["udp_port"], udp_port);
        assert_eq!(welcome["udp_listening"], true);

        let sender = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let packet = b"/fader\0\0,f\0\0\x3f\x00\x00\x00";
        sender.send_to(packet, ("127.0.0.1", udp_port)).unwrap();

        match socket.next().await.unwrap().unwrap() {
            Message::Binary(bytes) => assert_eq!(&bytes[..], &packet[..]),
            other => panic!("expected the raw datagram, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn refuses_other_origins() {
        let ws_port = free_port();
        tokio::spawn(run(ws_port, free_udp_port()));
        assert!(connect(ws_port, Some("https://evil.example")).await.is_err());
        assert!(connect(ws_port, None).await.is_ok());
    }

    #[tokio::test]
    async fn moves_the_udp_port_on_request() {
        let (ws_port, new_port) = (free_port(), free_udp_port());
        tokio::spawn(run(ws_port, free_udp_port()));

        let mut socket = connect(ws_port, Some("tauri://localhost")).await.unwrap();
        next_json(&mut socket).await;

        let request = json!({ "type": "set_udp_port", "port": new_port }).to_string();
        socket.send(Message::Text(request.into())).await.unwrap();
        let status = next_json(&mut socket).await;
        assert_eq!(status["type"], "status");
        assert_eq!(status["udp_port"], new_port);
        assert_eq!(status["udp_listening"], true);
    }

    #[tokio::test]
    async fn reports_a_busy_udp_port_but_stays_reachable() {
        let held = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        let busy = held.local_addr().unwrap().port();
        let ws_port = free_port();
        tokio::spawn(run(ws_port, busy));

        let mut socket = connect(ws_port, None).await.unwrap();
        let welcome = next_json(&mut socket).await;
        assert_eq!(welcome["udp_listening"], false);
        assert!(welcome["udp_error"].as_str().unwrap().contains(&busy.to_string()));
    }

    #[test]
    fn parses_ports_like_the_python_bridge() {
        assert_eq!(parse_port(Some(&json!(9001))), Some(9001));
        assert_eq!(parse_port(Some(&json!("9001"))), Some(9001));
        assert_eq!(parse_port(Some(&json!(0))), None);
        assert_eq!(parse_port(Some(&json!(70000))), None);
        assert_eq!(parse_port(Some(&json!(-1))), None);
        assert_eq!(parse_port(None), None);
    }
}
