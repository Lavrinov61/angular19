#!/bin/bash

# Script to create PostgreSQL database for Magnus Photo application

set -e

echo "Creating PostgreSQL database for Magnus Photo..."

# Read database configuration from environment or use defaults
DB_NAME="${DB_NAME:-magnus_photo_db}"
DB_USER="${DB_USER:-magnus_user}"
DB_PASSWORD="${DB_PASSWORD:-magnus_password_123}"

echo "Database name: $DB_NAME"
echo "Database user: $DB_USER"

# Create database and user
sudo -u postgres psql <<EOF
-- Create database if not exists
SELECT 'CREATE DATABASE $DB_NAME'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

-- Create user if not exists
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
    CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF

echo "Database and user created successfully!"

# Apply schema
echo "Applying database schema..."
psql -U $DB_USER -d $DB_NAME -f "$(dirname "$0")/database/schema.sql"

echo "Database setup complete!"

