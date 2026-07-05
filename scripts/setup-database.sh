#!/bin/bash

# Magnus Photo - Database Setup Script
# Creates PostgreSQL database, user, and applies schema

set -e  # Exit on error

echo "=================================="
echo "Magnus Photo Database Setup"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default database configuration
DB_NAME="magnus_photo"
DB_USER="magnus_user"
DB_PASSWORD="magnus_secure_password_$(openssl rand -hex 8)"

# Check if PostgreSQL is running
if ! sudo systemctl is-active --quiet postgresql; then
    echo -e "${RED}Error: PostgreSQL is not running${NC}"
    echo "Start it with: sudo systemctl start postgresql"
    exit 1
fi

echo -e "${GREEN}[1/4] Creating PostgreSQL user and database...${NC}"

# Create database user and database
sudo -u postgres psql <<EOF
-- Drop existing database and user if they exist
DROP DATABASE IF EXISTS $DB_NAME;
DROP USER IF EXISTS $DB_USER;

-- Create new user
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';

-- Create database
CREATE DATABASE $DB_NAME OWNER $DB_USER;

-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;

\c $DB_NAME

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\q
EOF

echo -e "${GREEN}✓ Database '$DB_NAME' and user '$DB_USER' created${NC}"

echo ""
echo -e "${GREEN}[2/4] Applying database schema...${NC}"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="$PROJECT_ROOT/backend/database/schema.sql"

if [ ! -f "$SCHEMA_FILE" ]; then
    echo -e "${RED}Error: Schema file not found at $SCHEMA_FILE${NC}"
    exit 1
fi

# Apply schema
PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -f "$SCHEMA_FILE"

echo -e "${GREEN}✓ Schema applied successfully${NC}"

echo ""
echo -e "${GREEN}[3/4] Verifying database structure...${NC}"

# Count tables
TABLE_COUNT=$(PGPASSWORD=$DB_PASSWORD psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")

echo -e "${GREEN}✓ Created $TABLE_COUNT tables${NC}"

echo ""
echo -e "${GREEN}[4/4] Saving configuration...${NC}"

# Create or update .env file
ENV_FILE="$PROJECT_ROOT/backend/.env"

if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Warning: $ENV_FILE already exists${NC}"
    echo "Database credentials:"
else
    # Create .env from example
    cp "$PROJECT_ROOT/backend/.env.example" "$ENV_FILE"

    # Update database credentials
    sed -i "s/DB_NAME=.*/DB_NAME=$DB_NAME/" "$ENV_FILE"
    sed -i "s/DB_USER=.*/DB_USER=$DB_USER/" "$ENV_FILE"
    sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=$DB_PASSWORD/" "$ENV_FILE"

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$ENV_FILE"

    echo -e "${GREEN}✓ Created $ENV_FILE with database credentials${NC}"
fi

echo ""
echo -e "${GREEN}=================================="
echo "✓ Database setup completed!"
echo "==================================${NC}"
echo ""
echo "Database credentials:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Password: $DB_PASSWORD"
echo ""
echo "Connection string:"
echo "  postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo ""
echo "Next steps:"
echo "1. Update backend/.env with Yandex OAuth credentials"
echo "2. Run: cd backend && npm install"
echo "3. Run: npm run dev"
echo "4. Test: curl http://localhost:3000/health"
echo ""
