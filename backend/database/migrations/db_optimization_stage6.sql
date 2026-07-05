-- Stage 6: DB Optimization
-- Pool tuning already in db.ts (min:5, statement_timeout:30s, idle_in_tx:60s)
-- This migration: pg_stat_statements, DB-level timeouts, duplicate index cleanup
--
-- NOTE: pg_stat_statements requires superuser — enable via Yandex Cloud console:
--   Managed PostgreSQL → Cluster → DBMS settings → pg_stat_statements (already in shared_preload_libraries)
--   Then run: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- 1. DB-level timeout safety net
--    Pool sets per-connection, but DB-level catches any bypass
--    (apply to new connections only)
-- ============================================================
ALTER DATABASE magnus_photo_db SET statement_timeout = '30s';
ALTER DATABASE magnus_photo_db SET idle_in_transaction_session_timeout = '60s';

-- ============================================================
-- 2. Drop REDUNDANT indexes
--    Where a UNIQUE constraint already provides the same btree
-- ============================================================

-- photo_print_orders: order_id has UNIQUE constraint
DROP INDEX IF EXISTS idx_photo_print_orders_order_id;

-- refresh_tokens: token has UNIQUE constraint
DROP INDEX IF EXISTS idx_refresh_tokens_token;

-- replay_chunks: (session_id, chunk_index) has UNIQUE constraint (208 KB saved)
DROP INDEX IF EXISTS idx_replay_chunks_session;

-- visitor_chat_messages: external_message_id UNIQUE with same WHERE
DROP INDEX IF EXISTS idx_vcm_ext_msg_id;

-- bridge_devices: api_key has UNIQUE constraint
DROP INDEX IF EXISTS idx_bridge_devices_api_key;

-- crm_files: uuid has UNIQUE constraint
DROP INDEX IF EXISTS idx_crm_files_uuid;

-- customer_feedback: (entity_type, entity_id) has UNIQUE constraint
DROP INDEX IF EXISTS idx_customer_feedback_entity;

-- gallery_photos: slug has UNIQUE constraint
DROP INDEX IF EXISTS idx_gallery_photos_slug;

-- loyalty_profiles: referral_code has UNIQUE constraint
DROP INDEX IF EXISTS idx_loyalty_referral;

-- loyalty_profiles: telegram_user_id has UNIQUE constraint
DROP INDEX IF EXISTS idx_loyalty_telegram_user;

-- partners: promo_code has UNIQUE constraint (partial WHERE IS NOT NULL redundant)
DROP INDEX IF EXISTS idx_partners_promo;

-- password_reset_tokens: token has UNIQUE constraint
DROP INDEX IF EXISTS idx_prt_token;

-- pending_oauth_links: token has UNIQUE constraint
DROP INDEX IF EXISTS idx_pending_oauth_token;

-- photo_approval_sessions: public_token has UNIQUE constraint
DROP INDEX IF EXISTS idx_approval_sessions_token;

-- photographers: user_id has UNIQUE constraint
DROP INDEX IF EXISTS idx_photographers_user_id;

-- promotions: slug has UNIQUE constraint
DROP INDEX IF EXISTS idx_promotions_slug;

-- push_subscriptions: endpoint has UNIQUE constraint
DROP INDEX IF EXISTS idx_push_subscriptions_endpoint;

-- rbac_permissions: slug has UNIQUE constraint
DROP INDEX IF EXISTS idx_rbac_permissions_slug;

-- schedule_preferences: photographer_id has UNIQUE constraint
DROP INDEX IF EXISTS idx_schedule_preferences_photographer;

-- service_categories: slug has UNIQUE constraint
DROP INDEX IF EXISTS idx_service_categories_slug;

-- telegram_auth_tokens: token has UNIQUE constraint
DROP INDEX IF EXISTS idx_telegram_auth_tokens_token;

-- telegram_users: telegram_id has UNIQUE constraint
DROP INDEX IF EXISTS idx_tg_users_telegram_id;

-- kb_entity_versions: (entity_id, version) UNIQUE covers DESC scan
DROP INDEX IF EXISTS idx_kb_versions_entity;

-- users table: all OAuth ID columns have UNIQUE constraints
DROP INDEX IF EXISTS idx_users_yandex_id;
DROP INDEX IF EXISTS idx_users_google_id;
DROP INDEX IF EXISTS idx_users_apple_id;
DROP INDEX IF EXISTS idx_users_sber_id;
DROP INDEX IF EXISTS idx_users_vk_id;
DROP INDEX IF EXISTS idx_users_mts_id;
DROP INDEX IF EXISTS idx_users_telegram_id;
DROP INDEX IF EXISTS idx_users_email;

-- ============================================================
-- 3. Drop EXACT DUPLICATE non-unique indexes
-- ============================================================

-- audit_log: two identical indexes on user_id
DROP INDEX IF EXISTS idx_audit_log_user;

-- audit_log: (entity_type, entity_id) covered by (entity_type, entity_id, created_at DESC)
DROP INDEX IF EXISTS idx_audit_log_entity;

-- partner_referrals: two identical (partner_id, created_at DESC)
DROP INDEX IF EXISTS idx_partner_referrals_partner;

-- visitor_chat_sessions: two identical (channel)
DROP INDEX IF EXISTS idx_visitor_sessions_channel;

-- visitor_chat_messages: two identical (session_id, created_at DESC) — biggest saving: 728 KB
DROP INDEX IF EXISTS idx_vcm_session_created;

-- work_tasks: two identical (priority)
DROP INDEX IF EXISTS idx_tasks_priority;

-- work_tasks: two identical (status)
DROP INDEX IF EXISTS idx_tasks_status;

-- visitor_chat_messages_archive: exact duplicate
DROP INDEX IF EXISTS visitor_chat_messages_archive_session_id_created_at_idx1;

-- visitor_chat_sessions_archive: exact duplicate
DROP INDEX IF EXISTS visitor_chat_sessions_archive_channel_idx1;

-- staff_messages: (conversation_id, created_at ASC) covered by DESC variant (reverse scan)
DROP INDEX IF EXISTS idx_staff_messages_conv;

-- chat_quick_replies: broad (category) redundant — partial (WHERE is_active) exists
DROP INDEX IF EXISTS idx_quick_replies_category;
