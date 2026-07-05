#!/bin/bash

# Magnus Photo - Development Startup Script
# Starts both backend and frontend in development mode

set -e

echo "=================================="
echo "Magnus Photo Development Startup"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Run: ./scripts/install-environment.sh"
    exit 1
fi

# Check if PostgreSQL is running
if ! sudo systemctl is-active --quiet postgresql; then
    echo -e "${YELLOW}Warning: PostgreSQL is not running. Starting...${NC}"
    sudo systemctl start postgresql
fi

# Check backend dependencies
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    cd "$PROJECT_ROOT/backend"
    npm install
    cd "$PROJECT_ROOT"
fi

# Check frontend dependencies
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    cd "$PROJECT_ROOT"
    npm install
fi

# Check backend .env
if [ ! -f "$PROJECT_ROOT/backend/.env" ]; then
    echo -e "${RED}Error: backend/.env not found${NC}"
    echo "Run: ./scripts/setup-database.sh"
    exit 1
fi

echo -e "${GREEN}Starting services...${NC}"
echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}[1/2] Starting backend on http://localhost:3000${NC}"
cd "$PROJECT_ROOT/backend"
npm run dev > ../logs/backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to start
sleep 3

# Check if backend is running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Error: Backend failed to start. Check logs/backend.log${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# Start frontend
echo -e "${GREEN}[2/2] Starting frontend on http://localhost:4200${NC}"
cd "$PROJECT_ROOT"
npm start > logs/frontend.log 2>&1 &
FRONTEND_PID=$!

echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

echo ""
echo -e "${GREEN}=================================="
echo "✓ Development servers running!"
echo "==================================${NC}"
echo ""
echo "Backend:  http://localhost:3000"
echo "Frontend: http://localhost:4200"
echo "API Docs: http://localhost:3000/api-docs"
echo ""
echo "Logs:"
echo "  Backend:  tail -f logs/backend.log"
echo "  Frontend: tail -f logs/frontend.log"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for processes
wait
