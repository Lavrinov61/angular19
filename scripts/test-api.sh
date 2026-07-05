#!/bin/bash

# Magnus Photo - Test Backend API Script
# Tests basic API endpoints after backend starts

set -e

echo "=================================="
echo "Magnus Photo API Testing"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BACKEND_URL="http://localhost:3000"

# Check if backend is running
echo -e "${YELLOW}Checking if backend is running...${NC}"
if ! curl -s -f "$BACKEND_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Backend is not running at $BACKEND_URL${NC}"
    echo "Start it with: cd backend && npm run dev"
    exit 1
fi

echo -e "${GREEN}✓ Backend is running${NC}"
echo ""

# Test health endpoint
echo -e "${YELLOW}[1/5] Testing /health endpoint...${NC}"
RESPONSE=$(curl -s "$BACKEND_URL/health")
echo "Response: $RESPONSE"
if echo "$RESPONSE" | grep -q "ok"; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed${NC}"
fi
echo ""

# Test API base endpoint
echo -e "${YELLOW}[2/5] Testing /api endpoint...${NC}"
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api")
echo "Status Code: $STATUS_CODE"
if [ "$STATUS_CODE" -eq 200 ] || [ "$STATUS_CODE" -eq 404 ]; then
    echo -e "${GREEN}✓ API endpoint accessible${NC}"
else
    echo -e "${RED}✗ API endpoint failed${NC}"
fi
echo ""

# Test auth endpoints (should return 401 without token)
echo -e "${YELLOW}[3/5] Testing /api/auth endpoints...${NC}"

echo "  Testing POST /api/auth/register (should fail without data)..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/auth/register")
echo "  Status Code: $STATUS_CODE"
if [ "$STATUS_CODE" -eq 400 ] || [ "$STATUS_CODE" -eq 422 ]; then
    echo -e "${GREEN}  ✓ Register endpoint working${NC}"
fi

echo "  Testing POST /api/auth/login (should fail without credentials)..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/auth/login")
echo "  Status Code: $STATUS_CODE"
if [ "$STATUS_CODE" -eq 400 ] || [ "$STATUS_CODE" -eq 401 ]; then
    echo -e "${GREEN}  ✓ Login endpoint working${NC}"
fi
echo ""

# Test protected endpoints (should return 401)
echo -e "${YELLOW}[4/5] Testing protected endpoints (should return 401)...${NC}"

ENDPOINTS=(
    "/api/users"
    "/api/photographers"
    "/api/studios"
    "/api/bookings"
    "/api/orders"
    "/api/notifications"
    "/api/schedule"
    "/api/photo-approvals"
    "/api/dashboard/photographer/stats"
)

for endpoint in "${ENDPOINTS[@]}"; do
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL$endpoint")
    if [ "$STATUS_CODE" -eq 401 ]; then
        echo -e "${GREEN}  ✓ $endpoint returns 401 (protected)${NC}"
    else
        echo -e "${YELLOW}  ? $endpoint returns $STATUS_CODE${NC}"
    fi
done
echo ""

# Test database connection indirectly
echo -e "${YELLOW}[5/5] Testing database connectivity (via API)...${NC}"
# Try to register a test user (this will fail if DB is not connected)
RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test123","name":"Test User"}')

if echo "$RESPONSE" | grep -qi "error\|fail"; then
    echo "Response: $RESPONSE"
    if echo "$RESPONSE" | grep -qi "database\|connection"; then
        echo -e "${RED}✗ Database connection error${NC}"
    else
        echo -e "${GREEN}✓ Database is connected (API validation working)${NC}"
    fi
else
    echo -e "${GREEN}✓ Database appears to be working${NC}"
fi
echo ""

echo -e "${GREEN}=================================="
echo "✓ API testing completed!"
echo "==================================${NC}"
echo ""
echo "For detailed testing, use:"
echo "  - Postman collection (create one in /postman directory)"
echo "  - curl commands from TESTING_GUIDE.md"
echo "  - Backend integration tests: cd backend && npm test"
echo ""
