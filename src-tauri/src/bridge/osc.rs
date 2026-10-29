// OSC in.
//
// OSC arrives over UDP, which no webview can listen for, so the service owns
// the UDP socket and forwards each datagram byte for byte over the editor's
// WebSocket (`/osc`); src/osc/OSCManager.js decodes it.
//
// The UDP port is open only while an editor is connected: the first
// connection opens it, the last one to leave closes it, so an app that is not
// using OSC holds no port another program might want.
//
// Protocol:
//   - On connect, one JSON `welcome` with the UDP state.
//   - Every OSC datagram after that is a binary frame.
//   - `{"type": "set_udp_port", "port": N}` moves the UDP socket; every
//     editor then gets a JSON `status`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::UdpSocket;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// The usual OSC convention; the editor can move it.
pub const DEFAULT_UDP_PORT: u16 = 9000;

/// All interfaces: driving the editor from a phone or tablet running TouchOSC
/// is the point of the feature.
const UDP_HOST: &str = "0.0.0.0";

/// Per-editor queue depth. Control data is only worth delivering while it is
/// current, so a backed-up editor loses its oldest packets rather than
/// stalling the UDP receiver or growing without bound.
const CLIENT_QUEUE_SIZE: usize = 256;

/// How often to retry a busy UDP port, so OSC recovers by itself once the
/// other application lets go of it.
const UDP_RETRY: Duration = Duration::from_secs(3);

/// One editor's pending messages, oldest dropped on overflow.
struct ClientQueue {
    items: Mutex<VecDeque<Message>>,
    ready: Notify,
}

impl ClientQueue {
    fn new() -> Self {
        Self {
            items: Mutex::new(VecDeque::with_capacity(CLIENT_QUEUE_SIZE)),
            ready: Notify::new(),
        }
    }

    fn push(&self, item: Message) {
        let mut items = self.items.lock().unwrap();
        if items.len() >= CLIENT_QUEUE_SIZE {
            items.pop_front();
        }
        items.push_back(item);
        drop(items);
        self.ready.notify_one();
    }

    async fn pop(&self) -> Message {
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
    /// Why the UDP socket is not open, if it is not — shown in the OSC panel
    /// so it can name the real problem instead of guessing.
    error: Option<String>,
    receiver: Option<JoinHandle<()>>,
    retry: Option<JoinHandle<()>>,
    clients: usize,
}

pub struct OscHub {
    udp: tokio::sync::Mutex<UdpState>,
    clients: Mutex<Vec<(u64, Arc<ClientQueue>)>>,
    next_client: AtomicU64,
}

impl OscHub {
    pub fn new(udp_port: u16) -> Arc<Self> {
        Arc::new(Self {
            udp: tokio::sync::Mutex::new(UdpState {
                port: udp_port,
                error: None,
                receiver: None,
                retry: None,
                clients: 0,
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

    fn broadcast(&self, message: Message) {
        for (_, queue) in self.clients.lock().unwrap().iter() {
            queue.push(message.clone());
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
        let hub = Arc::clone(self);
        udp.receiver = Some(tokio::spawn(async move {
            let mut buf = vec![0u8; 65536];
            loop {
                // Windows reports ICMP "port unreachable" from an earlier send
                // as a receive error; nothing to do but keep listening.
                if let Ok((len, _)) = socket.recv_from(&mut buf).await {
                    hub.broadcast(Message::Binary(Bytes::copy_from_slice(&buf[..len])));
                }
            }
        }));
        udp.port = port;
        udp.error = None;
    }

    fn close_udp(udp: &mut UdpState) {
        for task in [udp.receiver.take(), udp.retry.take()].into_iter().flatten() {
            task.abort();
        }
        udp.error = None;
    }

    /// Open the UDP socket, recording rather than failing on a busy port.
    async fn open_udp(self: &Arc<Self>, udp: &mut UdpState) {
        let port = udp.port;
        match UdpSocket::bind((UDP_HOST, port)).await {
            Ok(socket) => self.install(udp, socket, port),
            Err(err) => {
                udp.error = Some(Self::busy_message(port, &err));
                self.start_retrying(udp);
            }
        }
    }

    fn start_retrying(self: &Arc<Self>, udp: &mut UdpState) {
        if udp.retry.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        let hub = Arc::clone(self);
        udp.retry = Some(tokio::spawn(async move {
            loop {
                tokio::time::sleep(UDP_RETRY).await;
                let mut udp = hub.udp.lock().await;
                if udp.receiver.is_some() || udp.clients == 0 {
                    return;
                }
                let port = udp.port;
                if let Ok(socket) = UdpSocket::bind((UDP_HOST, port)).await {
                    hub.install(&mut udp, socket, port);
                    hub.broadcast(Message::Text(Self::status("status", &udp).into()));
                    return;
                }
            }
        }));
    }

    /// Move to `port` at the editor's request.
    ///
    /// The new port is opened before the old one is released, so a refused
    /// request leaves working OSC where it was.
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
        self.broadcast(Message::Text(Self::status("status", &udp).into()));
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
                queue.push(Message::Text(status.to_string().into()));
            }
        }
    }

    pub async fn serve(self: Arc<Self>, socket: WebSocket) {
        let (mut sink, mut source) = socket.split();
        let queue = Arc::new(ClientQueue::new());

        {
            let mut udp = self.udp.lock().await;
            udp.clients += 1;
            if udp.clients == 1 {
                self.open_udp(&mut udp).await;
            }
            // Welcome first, then join the fan-out, so it is always the first frame.
            queue.push(Message::Text(Self::status("welcome", &udp).into()));
        }
        let id = self.next_client.fetch_add(1, Ordering::Relaxed);
        self.clients.lock().unwrap().push((id, Arc::clone(&queue)));

        let writer_queue = Arc::clone(&queue);
        let writer = tokio::spawn(async move {
            loop {
                if sink.send(writer_queue.pop().await).await.is_err() {
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
        let mut udp = self.udp.lock().await;
        udp.clients -= 1;
        if udp.clients == 0 {
            Self::close_udp(&mut udp);
        }
    }
}

/// A UDP port from the editor's request: an integer (or integer string) in
/// 1..=65535.
fn parse_port(value: Option<&Value>) -> Option<u16> {
    let port = match value? {
        Value::Number(n) => n.as_u64()?,
        Value::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    u16::try_from(port).ok().filter(|p| *p != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ports() {
        assert_eq!(parse_port(Some(&json!(9001))), Some(9001));
        assert_eq!(parse_port(Some(&json!("9001"))), Some(9001));
        assert_eq!(parse_port(Some(&json!(0))), None);
        assert_eq!(parse_port(Some(&json!(70000))), None);
        assert_eq!(parse_port(Some(&json!(-1))), None);
        assert_eq!(parse_port(None), None);
    }
}
