#!/usr/bin/env python3
"""
Rhizomium Integrated Server
Serves static files (editor UI) and provides API endpoints for viewer management.
Includes WebSocket frame streaming for dual-screen support.
"""

import subprocess
import time
import sys
import os
import asyncio
import threading
from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS

# Import frame streaming server
from frame_stream_server import FrameStreamServer, get_server

# Get the directory where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__,
            static_folder=BASE_DIR,
            static_url_path='')
CORS(app)  # Enable CORS for frontend requests


# ============================================================================
# Static File Serving
# ============================================================================

@app.route('/')
def index():
    """Serve the landing page."""
    return send_file(os.path.join(BASE_DIR, 'index.html'))


@app.route('/studio')
def studio():
    """Serve the editor/studio page."""
    return send_file(os.path.join(BASE_DIR, 'editor', 'index.html'))


@app.route('/editor')
def editor():
    """Serve the editor page (alias for /studio)."""
    return send_file(os.path.join(BASE_DIR, 'editor', 'index.html'))


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files from the project root."""
    file_path = os.path.join(BASE_DIR, path)

    # If it's a directory, try to serve index.html
    if os.path.isdir(file_path):
        index_path = os.path.join(file_path, 'index.html')
        if os.path.exists(index_path):
            return send_file(index_path)

    # Serve the file if it exists
    if os.path.exists(file_path):
        return send_file(file_path)

    # 404 if not found
    return jsonify({'error': 'File not found'}), 404


# ============================================================================
# API Endpoints
# ============================================================================

@app.route('/api/launch-viewer', methods=['POST'])
def launch_viewer():
    """Launch the external Rhizomium viewer application."""
    try:
        data = request.get_json() or {}
        viewer_path = data.get('viewer', 'rhizo_viewer.exe')

        # Auto-detect viewer: try .py first, then .exe
        if not os.path.exists(viewer_path):
            # Try rhizo_viewer.py in the base directory
            py_viewer = os.path.join(BASE_DIR, 'rhizo_viewer.py')
            if os.path.exists(py_viewer):
                viewer_path = py_viewer
            else:
                return jsonify({
                    'success': False,
                    'error': f'Viewer not found: {viewer_path} or {py_viewer}'
                }), 404

        print(f"[rhizo_server] Launching viewer: {viewer_path}")

        # Get launch options from request
        fullscreen = data.get('fullscreen', False)
        monitor = data.get('monitor', 'primary')
        
        # Launch the viewer process
        if viewer_path.endswith('.py'):
            # Build command arguments
            cmd = [
                sys.executable,
                viewer_path,
                '--ws',  # Enable WebSocket mode
                '--url', 'ws://localhost:8766/ws'  # Frame streaming URL
            ]
            
            # Add fullscreen flag if requested
            if fullscreen:
                cmd.append('--fullscreen')
            
            # Note: Monitor selection would need to be implemented in the viewer
            # For now, we'll pass it as an environment variable or future parameter
            process = subprocess.Popen(cmd, env={**os.environ, 'RHIZO_MONITOR': str(monitor)})
        else:
            # Launch executable
            process = subprocess.Popen([viewer_path])

        # Wait briefly to ensure process starts
        time.sleep(1)

        # Check if process is still running (not immediately crashed)
        poll_result = process.poll()
        if poll_result is not None:
            return jsonify({
                'success': False,
                'error': f'Viewer process exited immediately with code {poll_result}'
            }), 500

        return jsonify({
            'success': True,
            'message': 'External viewer launched',
            'pid': process.pid
        }), 200

    except FileNotFoundError:
        return jsonify({
            'success': False,
            'error': f'Viewer executable not found: {viewer_path}'
        }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'service': 'rhizo_server',
        'version': '1.0.0'
    }), 200


@app.route('/api/status', methods=['GET'])
def status():
    """Get server status and configuration."""
    global frame_stream_server
    return jsonify({
        'status': 'running',
        'base_dir': BASE_DIR,
        'viewer_available': os.path.exists(os.path.join(BASE_DIR, 'rhizo_viewer.py')),
        'frame_streaming': {
            'enabled': frame_stream_server is not None,
            'viewers': len(frame_stream_server.viewers) if frame_stream_server else 0,
            'fps': round(frame_stream_server.fps, 2) if frame_stream_server else 0,
            'url': 'ws://localhost:8766/ws'
        },
        'endpoints': {
            'static': ['/', '/studio', '/editor', '/viewer.html'],
            'api': ['/api/health', '/api/status', '/api/launch-viewer', '/api/stream-frame']
        }
    }), 200


@app.route('/api/stream-frame', methods=['POST'])
def stream_frame():
    """
    Receive a frame from the editor and broadcast to viewers.

    Expected JSON body:
    {
        "width": 1920,
        "height": 1080,
        "format": "rgb",
        "data": "base64_encoded_frame_data"
    }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        # Extract frame parameters
        width = data.get('width')
        height = data.get('height')
        format_type = data.get('format', 'rgb')
        frame_data_b64 = data.get('data')

        if not all([width, height, frame_data_b64]):
            return jsonify({
                'success': False,
                'error': 'Missing required fields: width, height, data'
            }), 400

        # Decode base64 frame data
        import base64
        frame_data = base64.b64decode(frame_data_b64)

        # Broadcast frame to all connected viewers
        if frame_stream_server:
            # Schedule the broadcast in the event loop
            asyncio.run_coroutine_threadsafe(
                frame_stream_server.broadcast_frame(frame_data, width, height, format_type),
                frame_stream_loop
            )

            return jsonify({'success': True}), 200
        else:
            return jsonify({
                'success': False,
                'error': 'Frame streaming server not initialized'
            }), 503

    except Exception as e:
        print(f"[rhizo_server] Error streaming frame: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# Frame Streaming Server Management
# ============================================================================

# Global variables for frame streaming
frame_stream_server = None
frame_stream_loop = None
frame_stream_thread = None


def start_frame_stream_server():
    """Start the WebSocket frame streaming server in a separate thread"""
    global frame_stream_server, frame_stream_loop

    def run_server():
        global frame_stream_server, frame_stream_loop

        # Create new event loop for this thread
        frame_stream_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(frame_stream_loop)

        # Create and start server
        frame_stream_server = FrameStreamServer(host='0.0.0.0', port=8766)

        try:
            frame_stream_loop.run_until_complete(frame_stream_server.start())
            print("[rhizo_server] Frame streaming server started")

            # Keep the loop running
            frame_stream_loop.run_forever()
        except Exception as e:
            print(f"[rhizo_server] Frame streaming server error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            if frame_stream_server:
                frame_stream_loop.run_until_complete(frame_stream_server.stop())
            frame_stream_loop.close()

    # Start in daemon thread
    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()

    # Wait a moment for server to start
    time.sleep(1)

    return thread


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Start the Rhizomium integrated server."""
    global frame_stream_thread

    print("=" * 70)
    print("🌿 Rhizomium Integrated Server with Frame Streaming")
    print("=" * 70)
    print(f"Base directory: {BASE_DIR}")
    print()

    # Start frame streaming server
    print("Starting WebSocket frame streaming server...")
    frame_stream_thread = start_frame_stream_server()

    print()
    print("Available URLs:")
    print("  Landing Page:  http://127.0.0.1:5000/")
    print("  Editor:        http://127.0.0.1:5000/studio")
    print("  Editor (alt):  http://127.0.0.1:5000/editor")
    print("  Remote Viewer: http://127.0.0.1:5000/viewer.html")
    print()
    print("WebSocket:")
    print("  Frame Stream:  ws://127.0.0.1:8766/ws")
    print()
    print("API Endpoints:")
    print("  POST /api/launch-viewer - Launch external viewer")
    print("  POST /api/stream-frame  - Send frame to viewers")
    print("  GET  /api/health        - Health check")
    print("  GET  /api/status        - Server status")
    print()
    print("=" * 70)
    print("Press Ctrl+C to stop the server")
    print("=" * 70)

    # Run the Flask app
    try:
        app.run(
            host='127.0.0.1',
            port=5000,
            debug=False,  # Disable debug mode to prevent reloader conflicts
            use_reloader=False,
            threaded=True
        )
    finally:
        print("\n[rhizo_server] Shutting down frame streaming server...")
        if frame_stream_loop:
            frame_stream_loop.call_soon_threadsafe(frame_stream_loop.stop)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n[rhizo_server] Server stopped by user")
    except Exception as e:
        print(f"[rhizo_server] Error: {e}")
        import traceback
        traceback.print_exc()
