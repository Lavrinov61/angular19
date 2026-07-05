# Quick Start Guide

## Prerequisites Installation

### Option 1: Automated Installation (Recommended)

```bash
# Install Node.js 20 and PostgreSQL 15
./scripts/install-environment.sh

# Setup database
./scripts/setup-database.sh
```

### Option 2: Manual Installation

#### Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Install PostgreSQL 15
```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/trusted.gpg.d/pgdg.asc &>/dev/null
sudo apt-get update
sudo apt-get install -y postgresql-15 postgresql-contrib-15
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## Quick Start

### 1. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ..
npm install
```

### 2. Configure Environment

```bash
# Copy example files
cp backend/.env.example backend/.env
cp .env.example .env

# Edit backend/.env and set:
# - Database credentials (if not using setup-database.sh)
# - JWT_SECRET (generate with: openssl rand -base64 32)
# - Yandex OAuth credentials
```

### 3. Initialize Database

```bash
# Automated (creates DB, user, applies schema)
./scripts/setup-database.sh

# Or manual
sudo -u postgres psql
CREATE DATABASE magnus_photo;
CREATE USER magnus_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE magnus_photo TO magnus_user;
\c magnus_photo
\i backend/database/schema.sql
\q
```

### 4. Start Development Servers

```bash
# Option 1: Start both servers at once
./scripts/start-dev.sh

# Option 2: Start separately in different terminals

# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
npm start
```

### 5. Verify Installation

```bash
# Check backend
curl http://localhost:3000/health

# Check frontend
# Open browser: http://localhost:4200
```

## Next Steps

### Migrate Data from Firebase (if applicable)

```bash
# Configure Firebase credentials in backend/.env
# Then run migration
cd backend
npm run migrate:firestore
```

### Run Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd ..
npm test
```

## Troubleshooting

### Backend won't start
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify database connection in backend/.env
- Check logs: `tail -f logs/backend.log`

### Frontend won't compile
- Clear cache: `rm -rf .angular/cache`
- Reinstall: `rm -rf node_modules && npm install`

### Database connection errors
- Verify PostgreSQL is accepting connections
- Check credentials in backend/.env
- Test connection: `psql -h localhost -U magnus_user -d magnus_photo`

## Development URLs

- Backend API: http://localhost:3000
- Frontend: http://localhost:4200
- API Documentation: http://localhost:3000/api-docs (when implemented)

## Available Scripts

### Backend
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run migrate:firestore` - Migrate data from Firebase

### Frontend
- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run lint` - Lint code
