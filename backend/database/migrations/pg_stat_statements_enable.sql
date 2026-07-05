-- pg_stat_statements: enable (idempotent)
-- Prerequisite: включить расширение в YC Console:
--   Managed PostgreSQL → Cluster → Настройки СУБД → PostgreSQL extensions → pg_stat_statements
--   или: yc managed-postgresql cluster update <cluster-id> --postgresql-extensions pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
