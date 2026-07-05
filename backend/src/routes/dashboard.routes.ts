import { Router } from 'express';
import { authenticateToken, requirePermission, requireUser, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { pool } from '../database/db.js';

const router = Router();

// Get photographer dashboard stats
router.get('/photographer/stats', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;

  // Check if user is photographer
  const photographerCheck = await pool.query(
    'SELECT user_id FROM photographers WHERE user_id = $1',
    [photographerId]
  );

  if (photographerCheck.rows.length === 0) {
    throw new AppError(403, 'Only photographers can access this endpoint');
  }

  // Get bookings stats
  const bookingsStats = await pool.query(
    `SELECT
      COUNT(*) as total_bookings,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_bookings,
      COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_bookings,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_bookings,
      COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_bookings,
      COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE) as upcoming_bookings,
      COUNT(*) FILTER (WHERE booking_date = CURRENT_DATE) as today_bookings
    FROM bookings
    WHERE photographer_id = $1`,
    [photographerId]
  );

  // Get revenue stats
  const revenueStats = await pool.query(
    `SELECT
      COALESCE(SUM(total_price), 0) as total_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE DATE_TRUNC('month', booking_date) = DATE_TRUNC('month', CURRENT_DATE)), 0) as monthly_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE DATE_TRUNC('week', booking_date) = DATE_TRUNC('week', CURRENT_DATE)), 0) as weekly_revenue
    FROM bookings
    WHERE photographer_id = $1 AND status = 'completed'`,
    [photographerId]
  );

  // Get photo sessions stats
  const sessionsStats = await pool.query(
    `SELECT
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_sessions,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_sessions,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions,
      COALESCE(SUM(total_photos), 0) as total_photos
    FROM photo_sessions
    WHERE photographer_id = $1`,
    [photographerId]
  );

  // Get approval stats
  const approvalsStats = await pool.query(
    `SELECT
      COUNT(*) as total_approvals,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_approvals,
      COUNT(*) FILTER (WHERE status = 'approved') as approved_approvals,
      COUNT(*) FILTER (WHERE status = 'rejected') as rejected_approvals,
      COUNT(*) FILTER (WHERE status = 'changes_requested') as changes_requested
    FROM photo_approvals
    WHERE photographer_id = $1`,
    [photographerId]
  );

  // Get recent activity
  const recentBookings = await pool.query(
    `SELECT
      b.id, b.booking_date, b.start_time, b.status,
      u.display_name as client_name, u.avatar_url as client_avatar
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    WHERE b.photographer_id = $1
    ORDER BY b.booking_date DESC, b.start_time DESC
    LIMIT 5`,
    [photographerId]
  );

  res.json({
    bookings: bookingsStats.rows[0],
    revenue: revenueStats.rows[0],
    sessions: sessionsStats.rows[0],
    approvals: approvalsStats.rows[0],
    recent_bookings: recentBookings.rows,
    updated_at: new Date().toISOString(),
  });
});

// Get admin dashboard stats
router.get('/admin/stats', authenticateToken, requirePermission('analytics:view'), async (req: AuthRequest, res): Promise<void> => {
  // Users stats
  const usersStats = await pool.query(`
    SELECT
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE role = 'user') as regular_users,
      COUNT(*) FILTER (WHERE role = 'photographer') as photographers,
      COUNT(*) FILTER (WHERE role = 'admin') as admins,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_users_last_month
    FROM users
  `);

  // Bookings stats
  const bookingsStats = await pool.query(`
    SELECT
      COUNT(*) as total_bookings,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_bookings_last_month,
      COALESCE(SUM(total_price), 0) as total_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE status = 'completed' AND DATE_TRUNC('month', booking_date) = DATE_TRUNC('month', CURRENT_DATE)), 0) as monthly_revenue
    FROM bookings
  `);

  // Studios stats
  const studiosStats = await pool.query(`
    SELECT
      COUNT(*) as total_studios,
      COUNT(*) FILTER (WHERE is_featured = true) as featured_studios,
      COALESCE(AVG(rating), 0) as average_rating,
      COALESCE(SUM(total_reviews), 0) as total_reviews
    FROM studios
  `);

  // Photo sessions stats
  const sessionsStats = await pool.query(`
    SELECT
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COALESCE(SUM(total_photos), 0) as total_photos
    FROM photo_sessions
  `);

  // Orders stats
  const ordersStats = await pool.query(`
    SELECT
      COUNT(*) as total_orders,
      COUNT(*) FILTER (WHERE order_status = 'pending') as pending,
      COUNT(*) FILTER (WHERE order_status = 'completed') as completed,
      COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_orders,
      COALESCE(SUM(total_amount), 0) as total_order_amount
    FROM orders
  `);

  // Recent activity
  const recentBookings = await pool.query(`
    SELECT
      b.id, b.booking_date, b.start_time, b.status,
      u.display_name as client_name,
      p.display_name as photographer_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    LEFT JOIN users p ON b.photographer_id = p.id
    ORDER BY b.created_at DESC
    LIMIT 10
  `);

  res.json({
    users: usersStats.rows[0],
    bookings: bookingsStats.rows[0],
    studios: studiosStats.rows[0],
    sessions: sessionsStats.rows[0],
    orders: ordersStats.rows[0],
    recent_activity: recentBookings.rows,
    updated_at: new Date().toISOString(),
  });
});

// Get photographer services
router.get('/photographer/services', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;

  const result = await pool.query(
    `SELECT
      id, photographer_id, service_type, service_name,
      description, base_price, duration_hours, is_active,
      created_at, updated_at
    FROM photographer_services
    WHERE photographer_id = $1
    ORDER BY service_type, service_name`,
    [photographerId]
  );

  res.json({
    services: result.rows,
    total: result.rowCount,
  });
});

// Update photographer services
router.put('/photographer/services', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { services } = req.body;

  if (!Array.isArray(services)) {
    throw new AppError(400, 'services must be an array');
  }

  // Begin transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing services
    await client.query(
      'DELETE FROM photographer_services WHERE photographer_id = $1',
      [photographerId]
    );

    // Insert new services
    const insertedServices = [];
    for (const service of services) {
      const result = await client.query(
        `INSERT INTO photographer_services (
          photographer_id, service_type, service_name,
          description, base_price, duration_hours, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          photographerId,
          service.service_type,
          service.service_name,
          service.description || null,
          service.base_price,
          service.duration_hours || 1,
          service.is_active !== undefined ? service.is_active : true,
        ]
      );
      insertedServices.push(result.rows[0]);
    }

    await client.query('COMMIT');

    res.json({
      message: 'Services updated successfully',
      services: insertedServices,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// Get revenue chart data (photographer)
router.get('/photographer/revenue-chart', authenticateToken, async (req: AuthRequest, res): Promise<void> => {
  requireUser(req, res);
  const photographerId = req.user.id;
  const { period = 'month' } = req.query; // 'week', 'month', 'year'

  let dateFormat;
  let dateInterval;

  switch (period) {
    case 'week':
      dateFormat = 'YYYY-MM-DD';
      dateInterval = '7 days';
      break;
    case 'year':
      dateFormat = 'YYYY-MM';
      dateInterval = '12 months';
      break;
    case 'month':
    default:
      dateFormat = 'YYYY-MM-DD';
      dateInterval = '30 days';
  }

  const result = await pool.query(
    `SELECT
      TO_CHAR(booking_date, $1) as period,
      COUNT(*) as bookings_count,
      COALESCE(SUM(total_price), 0) as revenue
    FROM bookings
    WHERE photographer_id = $2
      AND status = 'completed'
      AND booking_date >= CURRENT_DATE - INTERVAL '${dateInterval}'
    GROUP BY period
    ORDER BY period`,
    [dateFormat, photographerId]
  );

  res.json({
    period,
    data: result.rows,
  });
});

export default router;
