-- 106 postgres_fdw setup — cross-DB access к multiplatform_publication
-- Only for analytics/batch. NOT for hot path (queries hang if MP PG down).
--
-- ВАЖНО: запускать от superuser (postgres). IMPORT FOREIGN SCHEMA требует
-- user mapping для текущего user → выполняется в DO-блоке от magnus_user
-- через SET ROLE (rollback-safe).

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

DROP SERVER IF EXISTS mp_server CASCADE;
CREATE SERVER mp_server FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '127.0.0.1', port '5432', dbname 'multiplatform_publication');

-- User mapping — пароль из .env магнуса (см. MP_DB_PASSWORD)
CREATE USER MAPPING IF NOT EXISTS FOR magnus_user SERVER mp_server
  OPTIONS (user 'bitrix_user', password 'SvfBitrix2026Prod!');

GRANT USAGE ON FOREIGN SERVER mp_server TO magnus_user;

CREATE SCHEMA IF NOT EXISTS mp_fdw;

-- magnus_user нужен CREATE, чтобы IMPORT FOREIGN SCHEMA создал foreign tables
GRANT USAGE, CREATE ON SCHEMA mp_fdw TO magnus_user;

-- IMPORT от magnus_user (у него есть user mapping)
SET ROLE magnus_user;

IMPORT FOREIGN SCHEMA public LIMIT TO (fingerprint_visitors, ad_clicks, visitor_sessions, conversions)
  FROM SERVER mp_server INTO mp_fdw;

RESET ROLE;

-- Lock down: magnus_user может только SELECT, CREATE убран
REVOKE CREATE ON SCHEMA mp_fdw FROM magnus_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA mp_fdw FROM magnus_user;
GRANT SELECT ON ALL TABLES IN SCHEMA mp_fdw TO magnus_user;
