// The app's connection service: OSC in, NDI out, Live Input (NDI and pushed
// frames) — everything the editor's webview cannot do itself because it
// cannot open UDP sockets or load native libraries.
//
// One loopback HTTP/WebSocket server inside the app, started the first time
// the editor asks for any of it (the `start_bridge` command, called by
// src/utils/bridgeAvailability.js before a feature connects). Each feature
// then holds its resources only while in use; see osc.rs and video.rs.
//
//   ws   /osc                OSC datagrams to the editor
//   ws   /video              NDI output and Live Input sources
//   ws   /publish[/<name>]   other programs pushing frames (also bare `/`)
//   POST /publish/<name>     one JPEG/PNG frame

pub mod ndi;
mod osc;
mod video;

use std::sync::Arc;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use bytes::Bytes;
use serde_json::json;
use tokio::net::TcpListener;

/// The service's port (BRIDGE_PORT in bridgeAvailability.js; allowed by the
/// desktop CSP). Loopback only.
pub const PORT: u16 = 8767;

/// Origins the editor is served from. Any page in the user's browser could
/// otherwise open these sockets — watch their control surface, or publish
/// onto their network. Clients with no Origin (TouchDesigner, scripts) pass.
const ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    // `npm run tauri:dev` serves the editor from Vite.
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];

#[derive(Clone)]
struct Hubs {
    osc: Arc<osc::OscHub>,
    video: Arc<video::VideoHub>,
}

async fn check_origin(request: Request, next: Next) -> Response {
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        if !ALLOWED_ORIGINS.contains(&origin.to_str().unwrap_or("")) {
            return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
        }
    }
    next.run(request).await
}

async fn osc_socket(ws: WebSocketUpgrade, State(hubs): State<Hubs>) -> Response {
    ws.on_upgrade(move |socket| hubs.osc.serve(socket))
}

async fn video_socket(ws: WebSocketUpgrade, State(hubs): State<Hubs>) -> Response {
    ws.max_message_size(video::MAX_FRAME_PIXELS * 4)
        .on_upgrade(move |socket| hubs.video.serve_editor(socket))
}

async fn publish_socket(ws: WebSocketUpgrade, State(hubs): State<Hubs>) -> Response {
    ws.max_message_size(video::MAX_FRAME_PIXELS * 4)
        .on_upgrade(move |socket| hubs.video.serve_publisher(socket, None))
}

async fn publish_named_socket(
    ws: WebSocketUpgrade,
    Path(name): Path<String>,
    State(hubs): State<Hubs>,
) -> Response {
    let Some(name) = video::clean_stream_name(Some(&name)) else {
        return (StatusCode::BAD_REQUEST, "invalid stream name").into_response();
    };
    ws.max_message_size(video::MAX_FRAME_PIXELS * 4)
        .on_upgrade(move |socket| hubs.video.serve_publisher(socket, Some(name)))
}

async fn publish_post(Path(name): Path<String>, State(hubs): State<Hubs>, body: Bytes) -> Response {
    let Some(name) = video::clean_stream_name(Some(&name)) else {
        return (StatusCode::BAD_REQUEST, "invalid stream name").into_response();
    };
    match hubs.video.accept_encoded(&name, body) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": error }))).into_response()
        }
    }
}

fn router(osc_udp_port: u16) -> Router {
    let hubs = Hubs { osc: osc::OscHub::new(osc_udp_port), video: video::VideoHub::new() };
    Router::new()
        .route("/osc", get(osc_socket))
        .route("/video", get(video_socket))
        .route("/", get(publish_socket))
        .route("/publish", get(publish_socket))
        .route("/publish/{name}", get(publish_named_socket).post(publish_post))
        .layer(DefaultBodyLimit::max(video::MAX_ENCODED_BYTES))
        .layer(middleware::from_fn(check_origin))
        .with_state(hubs)
}

/// Serve on `listener` until the app exits.
async fn serve(listener: TcpListener, osc_udp_port: u16) {
    let _ = axum::serve(listener, router(osc_udp_port)).await;
}

static RUNNING: tokio::sync::Mutex<bool> = tokio::sync::Mutex::const_new(false);

/// Start the service if it is not running yet. Returns its port.
async fn ensure_running() -> Result<u16, String> {
    let mut running = RUNNING.lock().await;
    if !*running {
        let listener = TcpListener::bind(("127.0.0.1", PORT)).await.map_err(|err| {
            format!(
                "Rhizomium could not open its local connection port {PORT} ({err}). \
                 Another program — or a second copy of Rhizomium — is using it; \
                 close it and try again."
            )
        })?;
        tokio::spawn(serve(listener, osc::DEFAULT_UDP_PORT));
        *running = true;
    }
    Ok(PORT)
}

/// Called by the editor before it connects OSC, NDI output or a Live Input.
#[tauri::command]
pub async fn start_bridge() -> Result<u16, String> {
    ensure_running().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::Value;
    use std::time::Duration;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message;

    type Client = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    fn free_udp_port() -> u16 {
        std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    async fn start(udp_port: u16) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, udp_port));
        port
    }

    async fn connect(port: u16, path: &str, origin: Option<&str>) -> Result<Client, String> {
        let mut request = format!("ws://127.0.0.1:{port}{path}").into_client_request().unwrap();
        if let Some(origin) = origin {
            request.headers_mut().insert("origin", origin.parse().unwrap());
        }
        tokio_tungstenite::connect_async(request)
            .await
            .map(|(socket, _)| socket)
            .map_err(|e| e.to_string())
    }

    async fn next_json(socket: &mut Client) -> Value {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .expect("timed out")
                .unwrap()
                .unwrap();
            if let Message::Text(text) = message {
                return serde_json::from_str(text.as_str()).unwrap();
            }
        }
    }

    async fn next_binary(socket: &mut Client) -> Vec<u8> {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .expect("timed out")
                .unwrap()
                .unwrap();
            if let Message::Binary(bytes) = message {
                return bytes.to_vec();
            }
        }
    }

    #[tokio::test]
    async fn osc_opens_udp_for_editors_and_forwards_datagrams() {
        let udp_port = free_udp_port();
        let port = start(udp_port).await;

        // Nobody connected: the UDP port is free.
        assert!(std::net::UdpSocket::bind(("0.0.0.0", udp_port)).is_ok());

        let mut socket = connect(port, "/osc", Some("http://tauri.localhost")).await.unwrap();
        let welcome = next_json(&mut socket).await;
        assert_eq!(welcome["type"], "welcome");
        assert_eq!(welcome["udp_port"], udp_port);
        assert_eq!(welcome["udp_listening"], true);

        let sender = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let packet = b"/fader\0\0,f\0\0\x3f\x00\x00\x00";
        sender.send_to(packet, ("127.0.0.1", udp_port)).unwrap();
        assert_eq!(next_binary(&mut socket).await, packet.to_vec());

        // Last editor gone: the UDP port is released.
        socket.close(None).await.unwrap();
        let mut freed = false;
        for _ in 0..50 {
            if std::net::UdpSocket::bind(("0.0.0.0", udp_port)).is_ok() {
                freed = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(freed, "UDP port still held after the last editor left");
    }

    #[tokio::test]
    async fn osc_moves_the_udp_port_and_reports_a_busy_one() {
        let held = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        let busy = held.local_addr().unwrap().port();
        let port = start(busy).await;

        let mut socket = connect(port, "/osc", Some("tauri://localhost")).await.unwrap();
        let welcome = next_json(&mut socket).await;
        assert_eq!(welcome["udp_listening"], false);
        assert!(welcome["udp_error"].as_str().unwrap().contains(&busy.to_string()));

        let free = free_udp_port();
        let request = json!({ "type": "set_udp_port", "port": free }).to_string();
        socket.send(Message::Text(request.into())).await.unwrap();
        let status = next_json(&mut socket).await;
        assert_eq!(status["udp_port"], free);
        assert_eq!(status["udp_listening"], true);
    }

    #[tokio::test]
    async fn refuses_other_origins() {
        let port = start(free_udp_port()).await;
        assert!(connect(port, "/osc", Some("https://evil.example")).await.is_err());
        assert!(connect(port, "/video", Some("https://evil.example")).await.is_err());
        assert!(connect(port, "/osc", None).await.is_ok());
    }

    #[tokio::test]
    async fn pushed_frames_reach_a_subscribed_live_input() {
        let port = start(free_udp_port()).await;

        let mut editor = connect(port, "/video", Some("http://tauri.localhost")).await.unwrap();
        let welcome = next_json(&mut editor).await;
        assert_eq!(welcome["type"], "welcome");
        assert!(welcome.get("ndi_available").is_some());

        let subscribe = json!({ "type": "subscribe", "source": "TD" }).to_string();
        editor.send(Message::Text(subscribe.into())).await.unwrap();

        // A TouchDesigner-style publisher on the bare host and port.
        let mut publisher = connect(port, "/", None).await.unwrap();
        let hello = json!({ "type": "hello", "name": "TD" }).to_string();
        publisher.send(Message::Text(hello.into())).await.unwrap();
        let header = json!({ "type": "frame", "width": 1, "height": 1, "format": "rgba" }).to_string();
        publisher.send(Message::Text(header.into())).await.unwrap();
        publisher.send(Message::Binary(vec![10, 20, 30, 255].into())).await.unwrap();

        loop {
            let message = next_json(&mut editor).await;
            if message["type"] == "frame" {
                assert_eq!(message["source"], "TD");
                assert_eq!(message["width"], 1);
                assert_eq!(message["format"], "rgba");
                break;
            }
        }
        assert_eq!(next_binary(&mut editor).await, vec![10, 20, 30, 255]);
    }

    #[tokio::test]
    async fn post_accepts_images_and_refuses_anything_else() {
        let port = start(free_udp_port()).await;
        let client = |body: &'static [u8]| async move {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let request = format!(
                "POST /publish/cam HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            stream.write_all(request.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            response
        };
        assert!(client(b"\x89PNG\r\n\x1a\n....").await.starts_with("HTTP/1.1 200"));
        assert!(client(b"GIF89a").await.starts_with("HTTP/1.1 400"));
    }

    #[tokio::test]
    async fn output_frames_of_the_wrong_size_are_refused() {
        let port = start(free_udp_port()).await;
        let mut editor = connect(port, "/video", None).await.unwrap();
        next_json(&mut editor).await;
        let header = json!({ "type": "frame", "width": 2, "height": 2, "format": "rgba" }).to_string();
        editor.send(Message::Text(header.into())).await.unwrap();
        editor.send(Message::Binary(vec![0; 3].into())).await.unwrap();
        let error = next_json(&mut editor).await;
        assert_eq!(error["type"], "error");
    }

    /// End to end over real NDI: the editor's output is published, found on
    /// the network, received and handed to a Live Input subscription. Needs
    /// the NDI Runtime; without it there is nothing to test and it passes.
    #[tokio::test(flavor = "multi_thread")]
    async fn ndi_output_round_trips_into_a_live_input() {
        if ndi::availability().is_err() {
            eprintln!("NDI Runtime not installed; skipping the NDI round trip");
            return;
        }
        let port = start(free_udp_port()).await;

        let mut output = connect(port, "/video", None).await.unwrap();
        assert_eq!(next_json(&mut output).await["ndi_available"], true);
        let name = json!({ "type": "set_source_name", "name": "Rhizomium Round Trip" }).to_string();
        output.send(Message::Text(name.into())).await.unwrap();

        let mut input = connect(port, "/video", None).await.unwrap();
        next_json(&mut input).await;
        let subscribe = json!({ "type": "subscribe", "source": "Rhizomium Round Trip" }).to_string();
        input.send(Message::Text(subscribe.into())).await.unwrap();

        let pixel = [200u8, 100, 50, 255];
        let frame = pixel.repeat(16 * 16);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let received = loop {
            assert!(tokio::time::Instant::now() < deadline, "no NDI frame came back");
            let header = json!({ "type": "frame", "width": 16, "height": 16, "format": "rgba" }).to_string();
            output.send(Message::Text(header.into())).await.unwrap();
            output.send(Message::Binary(frame.clone().into())).await.unwrap();
            match tokio::time::timeout(Duration::from_millis(100), input.next()).await {
                Ok(Some(Ok(Message::Text(text)))) => {
                    let message: Value = serde_json::from_str(text.as_str()).unwrap();
                    if message["type"] == "frame" {
                        assert_eq!(message["width"], 16);
                        break next_binary(&mut input).await;
                    }
                }
                _ => continue,
            }
        };
        assert_eq!(received.len(), 16 * 16 * 4);
        // NDI compresses; the colour comes back close, not exact.
        for (got, want) in received[..4].iter().zip(pixel) {
            assert!((*got as i32 - want as i32).abs() <= 8, "{:?}", &received[..4]);
        }
    }
}
