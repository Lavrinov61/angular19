-- Performance indexes for frequently queried columns
-- 2026-02-17

-- photo_print_orders.status (5+ queries filter by status)
CREATE INDEX IF NOT EXISTS idx_photo_print_orders_status
  ON photo_print_orders(status);

-- visitor_chat_sessions.channel (online/studio filter)
CREATE INDEX IF NOT EXISTS idx_visitor_chat_sessions_channel
  ON visitor_chat_sessions(channel);

-- work_tasks.priority (task board sorting)
CREATE INDEX IF NOT EXISTS idx_work_tasks_priority
  ON work_tasks(priority);

-- visitor_chat_messages composite (chat timeline performance)
CREATE INDEX IF NOT EXISTS idx_visitor_chat_messages_session_timeline
  ON visitor_chat_messages(session_id, created_at DESC);

-- work_tasks.status (inbox counts, board filters)
CREATE INDEX IF NOT EXISTS idx_work_tasks_status
  ON work_tasks(status);

-- notifications.user_id + read (unread count)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read) WHERE read = false;

-- bookings.start_time (upcoming bookings queries)
CREATE INDEX IF NOT EXISTS idx_bookings_start_time
  ON bookings(start_time DESC);
