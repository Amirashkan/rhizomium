#!/bin/bash
# Rhizomium Server Startup Script (Linux/Mac)

echo "🌿 Starting Rhizomium Server..."
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.8 or higher."
    exit 1
fi

# Check if dependencies are installed
echo "Checking dependencies..."
python3 -c "import flask" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  Flask not found. Installing dependencies..."
    pip3 install -r requirements.txt
fi

# Start the server
echo "✅ Starting server on http://127.0.0.1:5000"
echo ""
python3 rhizo_server.py
