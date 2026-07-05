-- ============================================================
-- Wave 2: Inbox Performance — DB Indexes
-- Применять: psql -U magnus_user -d magnus_photo_db < inbox_performance_indexes.sql
-- ============================================================

-- Visitor chat sessions: сортировка по last_message_at, фильтр по status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcs_status_last_message
  ON visitor_chat_sessions(status, last_message_at DESC NULLS LAST)
  WHERE status IN ('open', 'waiting', 'active');

-- Tasks: сортировка по priority + due_date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_status_priority
  ON work_tasks(status, priority, due_date ASC NULLS LAST, created_at DESC)
  WHERE status NOT IN ('completed', 'cancelled');

-- Tasks: assigned_to — для фильтра "мои задачи"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to
  ON work_tasks(assigned_to, status)
  WHERE status NOT IN ('completed', 'cancelled');

-- Bookings: ближайшие бронирования
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_start_time_status
  ON bookings(start_time ASC, status)
  WHERE status NOT IN ('cancelled', 'completed', 'no-show');

-- Photo print orders: очередь заказов
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_priority
  ON photo_print_orders(status, priority, created_at DESC)
  WHERE status NOT IN ('completed', 'cancelled');

-- Photo approval sessions: активные согласования
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approvals_status_updated
  ON photo_approval_sessions(status, updated_at DESC NULLS LAST)
  WHERE status NOT IN ('completed');

-- POS receipts: история по смене
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_shift_created
  ON pos_receipts(shift_id, created_at DESC);

-- POS receipts: по дате (для daily summary)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_created_date
  ON pos_receipts(DATE(created_at), total)
  WHERE is_refund = false;

-- Audit log: поиск по entity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_entity
  ON audit_log(entity_type, entity_id, created_at DESC);

-- Client notes: по телефону
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_phone_pinned
  ON client_notes(phone, is_pinned DESC, created_at DESC);

-- Visitor chat messages: последнее сообщение в сессии
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcm_session_created
  ON visitor_chat_messages(session_id, created_at DESC);

-- Staff messages: по conversation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_messages_conv_created
  ON staff_messages(conversation_id, created_at DESC);
