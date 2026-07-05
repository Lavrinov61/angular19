-- DB Optimization: expression index for normalized phone lookup
-- Fixes Seq Scan on RIGHT(REGEXP_REPLACE(contact_phone, '\D', '', 'g'), 10) queries
-- Used in: crm-clients.routes.ts, customer.service.ts

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ppo_phone_normalized
ON photo_print_orders (RIGHT(REGEXP_REPLACE(contact_phone, '\D', '', 'g'), 10))
WHERE contact_phone IS NOT NULL;

-- Drop idx_ppo_priority (idx_scan=0, subsumed by idx_ppo_priority_queue composite)
DROP INDEX CONCURRENTLY IF EXISTS idx_ppo_priority;

-- Refresh table statistics after index changes
ANALYZE photo_print_orders;
