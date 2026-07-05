#!/bin/bash

# Magnus Photo - Environment Installation Script
# This script installs Node.js 20 LTS and PostgreSQL 15 on Ubuntu/Debian

set -e  # Exit on error

echo "=================================="
echo "Magnus Photo Environment Setup"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}Error: This script should not be run as root${NC}"
   echo "Please run without sudo. The script will ask for sudo when needed."
   exit 1
fi

echo -e "${GREEN}[1/5] Updating system packages...${NC}"
sudo apt-get update

echo ""
echo -e "${GREEN}[2/5] Installing Node.js 20 LTS...${NC}"

# Check if Node.js is already installed
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 20 ]; then
        echo -e "${YELLOW}Node.js $NODE_VERSION is already installed${NC}"
    else
        echo -e "${YELLOW}Upgrading Node.js from version $NODE_VERSION to 20...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
else
    echo "Installing Node.js 20 from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION} installed${NC}"
echo -e "${GREEN}✓ npm ${NPM_VERSION} installed${NC}"

echo ""
echo -e "${GREEN}[3/5] Installing PostgreSQL 15...${NC}"

# Check if PostgreSQL is already installed
if command -v psql &> /dev/null; then
    PG_VERSION=$(psql --version | grep -oP '\d+' | head -1)
    if [ "$PG_VERSION" -ge 15 ]; then
        echo -e "${YELLOW}PostgreSQL $PG_VERSION is already installed${NC}"
    else
        echo -e "${YELLOW}Upgrading PostgreSQL from version $PG_VERSION...${NC}"
        sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
        wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/trusted.gpg.d/pgdg.asc &>/dev/null
        sudo apt-get update
        sudo apt-get install -y postgresql-15 postgresql-contrib-15
    fi
else
    echo "Installing PostgreSQL 15..."
    sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
    wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/trusted.gpg.d/pgdg.asc &>/dev/null
    sudo apt-get update
    sudo apt-get install -y postgresql-15 postgresql-contrib-15
fi

# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

PG_VERSION=$(psql --version)
echo -e "${GREEN}✓ ${PG_VERSION} installed and running${NC}"

echo ""
echo -e "${GREEN}[4/5] Installing additional tools...${NC}"
sudo apt-get install -y curl git build-essential

echo ""
echo -e "${GREEN}[5/5] Verification...${NC}"
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "PostgreSQL: $(psql --version)"
echo "Git: $(git --version)"

echo ""
echo -e "${GREEN}=================================="
echo "✓ Installation completed successfully!"
echo "==================================${NC}"
echo ""
echo "Next steps:"
echo "1. Run: ./scripts/setup-database.sh"
echo "2. Copy backend/.env.example to backend/.env and configure"
echo "3. Run: cd backend && npm install"
echo "4. Run: npm run dev"
echo ""
