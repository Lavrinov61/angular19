#!/bin/bash

# Script для запуска Angular SSR в development режиме с auto-rebuild

echo "🚀 Starting Magnus Photo in SSR development mode..."
echo ""
echo "Backend API: http://localhost:3001"
echo "Frontend SSR: http://localhost:4200"
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Проверка что backend запущен
echo -e "${BLUE}[1/3]${NC} Checking backend status..."
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend is running on http://localhost:3001"
else
    echo -e "${YELLOW}⚠${NC}  Backend is not running. Please start it first:"
    echo "    cd backend && npm run dev"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}[2/3]${NC} Building SSR application (first build may take time)..."

# Build SSR с development конфигурацией
npm run build:ssr -- --configuration development

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠${NC}  Build failed. Check errors above."
    exit 1
fi

echo ""
echo -e "${GREEN}✓${NC} Build completed successfully!"
echo ""
echo -e "${BLUE}[3/3]${NC} Starting SSR server..."
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Application is running in SSR mode!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC} http://localhost:4200"
echo -e "  ${BLUE}Backend API:${NC} http://localhost:3001"
echo ""
echo -e "${YELLOW}Note:${NC} For auto-reload on file changes, use separate terminal:"
echo "  Terminal 1: npm run dev:ssr (current)"
echo "  Terminal 2: npm run build:ssr -- --watch"
echo ""

# Запуск SSR сервера
PORT=4200 node dist/magnus-photo/server/server.mjs
