# Backend API Documentation

## Setup

1. Install dependencies:
```bash
cd angular-app/backend
npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Create PostgreSQL database:
```bash
sudo -u postgres psql
CREATE DATABASE magnus_photo_db;
CREATE USER magnus_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE magnus_photo_db TO magnus_user;
```

4. Run database migrations:
```bash
psql -U magnus_user -d magnus_photo_db -f database/schema.sql
```

5. Start development server:
```bash
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/yandex` - Yandex OAuth login
- `GET /api/auth/yandex/callback` - Yandex OAuth callback
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout

### Users
- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update current user profile
- `GET /api/users/:id` - Get user by ID

### Photographers
- `GET /api/photographers` - List photographers (with filters)
- `GET /api/photographers/me` - Get current photographer profile
- `GET /api/photographers/:id` - Get photographer by ID
- `PUT /api/photographers/me` - Update current photographer profile
- `GET /api/photographers/:id/reviews` - Get photographer reviews
- `POST /api/photographers/:id/reviews` - Add review

### Studios
- `GET /api/studios` - List studios
- `GET /api/studios/:id` - Get studio by ID
- `POST /api/studios` - Create studio (admin only)
- `PUT /api/studios/:id` - Update studio (admin only)
- `DELETE /api/studios/:id` - Delete studio (admin only)

### Shooting Locations
- `GET /api/shooting-locations` - List shooting locations
- `GET /api/shooting-locations/:id` - Get location by ID

### Bookings
- `GET /api/bookings` - List bookings
- `GET /api/bookings/:id` - Get booking details
- `POST /api/bookings` - Create booking
- `PUT /api/bookings/:id` - Update booking
- `DELETE /api/bookings/:id` - Delete booking

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files/:id` - Get file metadata
- `GET /api/files/:id/download` - Download file
- `DELETE /api/files/:id` - Delete file

## Database Schema

See `database/schema.sql` for complete schema definition.

Key tables:
- `users` - User accounts
- `photographers` - Photographer profiles
- `reviews` - Reviews for photographers
- `studios` - Studio locations
- `studio_reviews` - Reviews for studios
- `shooting_locations` - Outdoor shooting locations
- `bookings` - Booking records
- `orders` - Order records
- `photo_sessions` - Photo session records
- `photos` - Photo records
- `files` - File upload records

