#!/usr/bin/env python3
"""
Simple Flask API server for launching the Rhizomium external viewer.
Provides the /api/launch-viewer endpoint for the web UI.
"""

import subprocess
import time
import sys
import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests


@app.route('/api/launch-viewer', methods=['POST'])
def launch_viewer():
    """Launch the external Rhizomium viewer application."""
    try:
        data = request.get_json() or {}
        viewer_path = data.get('viewer', 'rhizo_viewer.exe')

        # Auto-detect viewer: try .py first, then .exe
        if not os.path.exists(viewer_path):
            # Try rhizo_viewer.py
            py_viewer = 'rhizo_viewer.py'
            if os.path.exists(py_viewer):
                viewer_path = py_viewer
            else:
                return jsonify({
                    'success': False,
                    'error': f'Viewer not found: {viewer_path} or {py_viewer}'
                }), 404

        print(f"[viewer_api] Launching viewer: {viewer_path}")

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
    return jsonify({'status': 'ok', 'service': 'viewer_api'}), 200


if __name__ == '__main__':
    print("Starting Rhizomium Viewer API server...")
    print("Endpoints:")
    print("  POST /api/launch-viewer - Launch external viewer")
    print("  GET  /api/health        - Health check")
    app.run(host='127.0.0.1', port=5000, debug=True)
