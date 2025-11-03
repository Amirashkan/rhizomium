#!/usr/bin/env python3
"""
Rhizomium Integrated Server
Serves static files (editor UI) and provides API endpoints for viewer management.
"""

import subprocess
import time
import sys
import os
from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS

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

        # Launch the viewer process
        if viewer_path.endswith('.py'):
            # Launch Python script
            process = subprocess.Popen([sys.executable, viewer_path])
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
    return jsonify({
        'status': 'running',
        'base_dir': BASE_DIR,
        'viewer_available': os.path.exists(os.path.join(BASE_DIR, 'rhizo_viewer.py')),
        'endpoints': {
            'static': ['/', '/studio', '/editor'],
            'api': ['/api/health', '/api/status', '/api/launch-viewer']
        }
    }), 200


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Start the Rhizomium integrated server."""
    print("=" * 70)
    print("🌿 Rhizomium Integrated Server")
    print("=" * 70)
    print(f"Base directory: {BASE_DIR}")
    print()
    print("Available URLs:")
    print("  Landing Page:  http://127.0.0.1:5000/")
    print("  Editor:        http://127.0.0.1:5000/studio")
    print("  Editor (alt):  http://127.0.0.1:5000/editor")
    print()
    print("API Endpoints:")
    print("  POST /api/launch-viewer - Launch external viewer")
    print("  GET  /api/health        - Health check")
    print("  GET  /api/status        - Server status")
    print()
    print("=" * 70)
    print("Press Ctrl+C to stop the server")
    print("=" * 70)

    # Run the Flask app
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=True,
        use_reloader=True
    )


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n[rhizo_server] Server stopped by user")
    except Exception as e:
        print(f"[rhizo_server] Error: {e}")
        import traceback
        traceback.print_exc()
