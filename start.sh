#!/bin/bash
# Startup script for Render deployment
# This builds the frontend and starts the backend server

echo "=== Sorim CRM Startup ==="

# Build the frontend
echo "Building frontend..."
cd frontend && npm install && npm run build && cd ..

# Start the backend
echo "Starting backend server..."
cd backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}