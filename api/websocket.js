/**
 * Vercel Edge Function for WebSocket Frame Streaming
 *
 * Note: Vercel Edge Runtime supports WebSocket upgrades
 * This provides real-time frame streaming for dual-screen setups
 */

export const config = {
  runtime: 'edge',
};

// Store active connections in memory
// Note: In production, use a service like Upstash Redis or Partykit for persistence
const viewers = new Set();
let frameCount = 0;
let lastFrame = null;
let lastMetadata = null;

export default async function handler(req) {
  const upgradeHeader = req.headers.get('Upgrade');

  // Handle WebSocket upgrade
  if (upgradeHeader === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      viewers.add(socket);
      console.log(`[Edge WS] Viewer connected (total: ${viewers.size})`);

      // Send welcome message
      socket.send(JSON.stringify({
        type: 'welcome',
        viewer_id: Date.now(),
        server_version: '2.0.0-vercel',
        capabilities: ['rgb', 'rgba', 'metadata']
      }));

      // Send current frame if available
      if (lastFrame && lastMetadata) {
        try {
          socket.send(JSON.stringify(lastMetadata));
          socket.send(lastFrame);
        } catch (error) {
          console.error('[Edge WS] Error sending initial frame:', error);
        }
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleViewerMessage(socket, data);
      } catch (error) {
        console.error('[Edge WS] Error parsing message:', error);
      }
    };

    socket.onerror = (error) => {
      console.error('[Edge WS] WebSocket error:', error);
    };

    socket.onclose = () => {
      viewers.delete(socket);
      console.log(`[Edge WS] Viewer disconnected (remaining: ${viewers.size})`);
    };

    return response;
  }

  // Handle HTTP requests (for frame uploads and stats)
  const { pathname } = new URL(req.url);

  if (req.method === 'POST' && pathname === '/api/websocket/stream') {
    return handleFrameUpload(req);
  }

  if (req.method === 'GET' && pathname === '/api/websocket/stats') {
    return handleStats();
  }

  // Default response
  return new Response(
    JSON.stringify({
      service: 'WebSocket Frame Streaming',
      version: '2.0.0-vercel',
      status: 'ready',
      viewers: viewers.size,
      frames: frameCount,
      endpoints: {
        websocket: 'ws://your-domain.vercel.app/api/ws',
        upload: 'POST /api/websocket/stream',
        stats: 'GET /api/websocket/stats'
      }
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    }
  );
}

function handleViewerMessage(socket, data) {
  const msgType = data.type;

  if (msgType === 'ping') {
    socket.send(JSON.stringify({
      type: 'pong',
      timestamp: Date.now()
    }));
  } else if (msgType === 'request_frame') {
    if (lastFrame && lastMetadata) {
      socket.send(JSON.stringify(lastMetadata));
      socket.send(lastFrame);
    } else {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'No frame available'
      }));
    }
  }
}

async function handleFrameUpload(req) {
  try {
    const data = await req.json();
    const { width, height, format, data: frameDataB64 } = data;

    if (!width || !height || !frameDataB64) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: width, height, data'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 frame data
    const frameData = Uint8Array.from(atob(frameDataB64), c => c.charCodeAt(0));

    // Prepare metadata
    const metadata = {
      type: 'frame_meta',
      width,
      height,
      format: format || 'rgb',
      timestamp: Date.now(),
      frame_number: ++frameCount,
      size: frameData.length
    };

    // Store for late-joining viewers
    lastMetadata = metadata;
    lastFrame = frameData;

    // Broadcast to all viewers
    const disconnected = [];
    for (const viewer of viewers) {
      try {
        if (viewer.readyState === 1) { // WebSocket.OPEN
          viewer.send(JSON.stringify(metadata));
          viewer.send(frameData);
        } else {
          disconnected.push(viewer);
        }
      } catch (error) {
        console.error('[Edge WS] Error sending frame:', error);
        disconnected.push(viewer);
      }
    }

    // Clean up disconnected viewers
    disconnected.forEach(v => viewers.delete(v));

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  } catch (error) {
    console.error('[Edge WS] Frame upload error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function handleStats() {
  return new Response(
    JSON.stringify({
      viewers: viewers.size,
      frames: frameCount,
      has_current_frame: lastFrame !== null,
      uptime: process.uptime ? process.uptime() : 0
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    }
  );
}
