import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { POSTGRES_CONFIRM, getPgConfig } from './config.js';
import { errorResponse, jsonResponse, textResponse, toErrorMessage, truncateRows } from './response.js';

const SqlParamSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ParamsSchema = z.array(SqlParamSchema).optional().default([]);

const pool = new Pool(getPgConfig());

pool.on('error', (error) => {
  console.error(`[mcp-angular-dev:postgres] idle client error: ${error.message}`);
});

export async function closePostgres(): Promise<void> {
  await pool.end();
}

export function registerPostgresTools(server: McpServer): void {
  server.tool(
    'pg_query',
    'Run a read-only PostgreSQL query in a READ ONLY transaction. Allows SELECT/WITH/SHOW/VALUES/TABLE/EXPLAIN only.',
    {
      sql: z.string().min(1),
      params: ParamsSchema,
      maxRows: z.number().int().min(1).max(1000).optional().default(200),
    },
    async ({ sql, params, maxRows }) => {
      try {
        const result = await runReadOnlyQuery(sql, params);
        const limited = truncateRows(result.rows, maxRows);
        return jsonResponse({
          command: result.command,
          rowCount: result.rowCount,
          fields: result.fields.map((field) => ({ name: field.name, dataTypeId: field.dataTypeID })),
          ...limited,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_list_tables',
    'List PostgreSQL tables/views/materialized views with row estimates and size data.',
    {
      schema: z.string().optional().default('public'),
      includeViews: z.boolean().optional().default(true),
    },
    async ({ schema, includeViews }) => {
      try {
        const relKinds = includeViews ? ['r', 'p', 'v', 'm', 'f'] : ['r', 'p'];
        const result = await pool.query(
          `
          SELECT
            n.nspname AS schema,
            c.relname AS name,
            CASE c.relkind
              WHEN 'r' THEN 'table'
              WHEN 'p' THEN 'partitioned_table'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized_view'
              WHEN 'f' THEN 'foreign_table'
              ELSE c.relkind::text
            END AS kind,
            c.reltuples::bigint AS estimated_rows,
            pg_total_relation_size(c.oid) AS total_bytes,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
            pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
            pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
            obj_description(c.oid, 'pg_class') AS comment
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relkind = ANY($2::"char"[])
          ORDER BY pg_total_relation_size(c.oid) DESC, c.relname ASC
          `,
          [schema, relKinds],
        );
        return jsonResponse({ tables: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_describe_table',
    'Describe a PostgreSQL table: columns, indexes, constraints, foreign keys, and size.',
    {
      schema: z.string().optional().default('public'),
      table: z.string().min(1),
    },
    async ({ schema, table }) => {
      try {
        const [columns, indexes, constraints, foreignKeys, size] = await Promise.all([
          pool.query(
            `
            SELECT
              ordinal_position,
              column_name,
              data_type,
              udt_name,
              is_nullable,
              column_default,
              character_maximum_length,
              numeric_precision,
              numeric_scale,
              datetime_precision
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            `,
            [schema, table],
          ),
          pool.query(
            `
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
            ORDER BY indexname
            `,
            [schema, table],
          ),
          pool.query(
            `
            SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid) AS definition
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = $1 AND rel.relname = $2
            ORDER BY con.contype, con.conname
            `,
            [schema, table],
          ),
          pool.query(
            `
            SELECT
              con.conname AS name,
              src_ns.nspname AS source_schema,
              src.relname AS source_table,
              pg_get_constraintdef(con.oid) AS definition,
              dst_ns.nspname AS referenced_schema,
              dst.relname AS referenced_table
            FROM pg_constraint con
            JOIN pg_class src ON src.oid = con.conrelid
            JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
            JOIN pg_class dst ON dst.oid = con.confrelid
            JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
            WHERE con.contype = 'f'
              AND src_ns.nspname = $1
              AND src.relname = $2
            ORDER BY con.conname
            `,
            [schema, table],
          ),
          pool.query(
            `
            SELECT
              pg_total_relation_size(to_regclass(format('%I.%I', $1::text, $2::text))) AS total_bytes,
              pg_size_pretty(pg_total_relation_size(to_regclass(format('%I.%I', $1::text, $2::text)))) AS total_size,
              pg_size_pretty(pg_relation_size(to_regclass(format('%I.%I', $1::text, $2::text)))) AS table_size,
              pg_size_pretty(pg_indexes_size(to_regclass(format('%I.%I', $1::text, $2::text)))) AS indexes_size
            `,
            [schema, table],
          ),
        ]);

        if (columns.rows.length === 0) {
          return errorResponse(`Table not found: ${schema}.${table}`);
        }

        return jsonResponse({
          table: `${schema}.${table}`,
          size: size.rows[0],
          columns: columns.rows,
          indexes: indexes.rows,
          constraints: constraints.rows,
          foreignKeys: foreignKeys.rows,
        });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_table_sizes',
    'Show PostgreSQL table sizes, index sizes, toast sizes, and estimated rows.',
    {
      schema: z.string().optional().default('public'),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async ({ schema, limit }) => {
      try {
        const result = await pool.query(
          `
          SELECT
            n.nspname AS schema,
            c.relname AS table,
            c.reltuples::bigint AS estimated_rows,
            pg_relation_size(c.oid) AS table_bytes,
            pg_indexes_size(c.oid) AS index_bytes,
            pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) AS toast_bytes,
            pg_total_relation_size(c.oid) AS total_bytes,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relkind IN ('r', 'p')
          ORDER BY pg_total_relation_size(c.oid) DESC
          LIMIT $2
          `,
          [schema, limit],
        );
        return jsonResponse({ tables: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_index_usage',
    'Show PostgreSQL index usage stats from pg_stat_user_indexes.',
    {
      schema: z.string().optional().default('public'),
      table: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async ({ schema, table, limit }) => {
      try {
        const result = await pool.query(
          `
          SELECT
            schemaname AS schema,
            relname AS table,
            indexrelname AS index,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
          FROM pg_stat_user_indexes
          WHERE schemaname = $1
            AND ($2::text IS NULL OR relname = $2)
          ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
          LIMIT $3
          `,
          [schema, table ?? null, limit],
        );
        return jsonResponse({ indexes: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_explain',
    'Run EXPLAIN (FORMAT JSON) for a read-only SQL query. ANALYZE executes the SELECT inside a READ ONLY transaction.',
    {
      sql: z.string().min(1),
      params: ParamsSchema,
      analyze: z.boolean().optional().default(false),
      buffers: z.boolean().optional().default(false),
      verbose: z.boolean().optional().default(false),
    },
    async ({ sql, params, analyze, buffers, verbose }) => {
      try {
        const statement = assertReadOnlySql(sql);
        const options = [
          'FORMAT JSON',
          `ANALYZE ${analyze ? 'true' : 'false'}`,
          `BUFFERS ${buffers ? 'true' : 'false'}`,
          `VERBOSE ${verbose ? 'true' : 'false'}`,
        ];
        const result = await runReadOnlyQuery(`EXPLAIN (${options.join(', ')}) ${statement}`, params);
        return jsonResponse({ plan: result.rows[0]?.['QUERY PLAN'] ?? result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_active_queries',
    'Show active PostgreSQL sessions for the current database.',
    {
      includeIdle: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ includeIdle, limit }) => {
      try {
        const result = await pool.query(
          `
          SELECT
            pid,
            usename,
            application_name,
            client_addr,
            state,
            wait_event_type,
            wait_event,
            now() - query_start AS query_age,
            now() - xact_start AS xact_age,
            left(query, 2000) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND ($1::boolean OR state <> 'idle')
          ORDER BY query_start NULLS LAST
          LIMIT $2
          `,
          [includeIdle, limit],
        );
        return jsonResponse({ sessions: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_locks',
    'Show PostgreSQL locks for the current database, including blocking relation and session context.',
    {
      onlyBlocked: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    async ({ onlyBlocked, limit }) => {
      try {
        const result = await pool.query(
          `
          SELECT
            l.pid,
            a.usename,
            a.state,
            l.locktype,
            l.mode,
            l.granted,
            l.relation::regclass::text AS relation,
            l.page,
            l.tuple,
            l.virtualxid,
            l.transactionid,
            a.wait_event_type,
            a.wait_event,
            now() - a.query_start AS query_age,
            left(a.query, 1200) AS query
          FROM pg_locks l
          LEFT JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.datname = current_database()
            AND ($1::boolean = false OR l.granted = false)
          ORDER BY l.granted ASC, a.query_start NULLS LAST
          LIMIT $2
          `,
          [onlyBlocked, limit],
        );
        return jsonResponse({ locks: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_slow_stats',
    'Show slow/frequent query stats from pg_stat_statements when the extension is enabled.',
    {
      orderBy: z.enum(['total_exec_time', 'mean_exec_time', 'calls', 'rows']).optional().default('total_exec_time'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ orderBy, limit }) => {
      try {
        const extension = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS enabled`,
        );
        if (!extension.rows[0]?.enabled) {
          return textResponse('pg_stat_statements is not enabled in this database.');
        }

        const result = await pool.query(
          `
          SELECT
            calls,
            rows,
            round(total_exec_time::numeric, 2) AS total_exec_ms,
            round(mean_exec_time::numeric, 2) AS mean_exec_ms,
            round(max_exec_time::numeric, 2) AS max_exec_ms,
            left(query, 2000) AS query
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY ${orderBy} DESC
          LIMIT $1
          `,
          [limit],
        );
        return jsonResponse({ queries: result.rows });
      } catch (error) {
        return errorResponse(toErrorMessage(error));
      }
    },
  );

  server.tool(
    'pg_admin_sql',
    `DANGEROUS: run one PostgreSQL write/admin SQL statement. Requires confirm="${POSTGRES_CONFIRM}". Dry-run defaults to true and rolls back.`,
    {
      sql: z.string().min(1),
      params: ParamsSchema,
      dryRun: z.boolean().optional().default(true),
      confirm: z.string().optional().default(''),
      maxRows: z.number().int().min(1).max(500).optional().default(100),
    },
    async ({ sql, params, dryRun, confirm, maxRows }) => {
      if (confirm !== POSTGRES_CONFIRM) {
        return errorResponse(`Refusing to run admin SQL. Pass confirm="${POSTGRES_CONFIRM}".`);
      }

      const statement = normalizeSingleStatement(sql);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
          process.env['MCP_PG_ADMIN_STATEMENT_TIMEOUT_MS'] || '15000',
        ]);
        const result = await client.query(statement, params);
        if (dryRun) {
          await client.query('ROLLBACK');
        } else {
          await client.query('COMMIT');
        }
        const limited = truncateRows(result.rows, maxRows);
        return jsonResponse({
          dryRun,
          command: result.command,
          rowCount: result.rowCount,
          ...limited,
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return errorResponse(toErrorMessage(error));
      } finally {
        client.release();
      }
    },
  );
}

async function runReadOnlyQuery(sql: string, params: Array<string | number | boolean | null>) {
  const statement = assertReadOnlySql(sql);
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
      process.env['MCP_PG_READONLY_STATEMENT_TIMEOUT_MS'] || '15000',
    ]);
    const result = await client.query(statement, params);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertReadOnlySql(sql: string): string {
  const statement = normalizeSingleStatement(sql);
  const withoutComments = stripSqlComments(statement).trim();
  const firstKeyword = withoutComments.match(/^\(?\s*([a-z]+)/i)?.[1]?.toLowerCase();
  const allowed = new Set(['select', 'with', 'show', 'values', 'table', 'explain']);

  if (!firstKeyword || !allowed.has(firstKeyword)) {
    throw new Error(`Only read-only SQL is allowed here. First keyword was "${firstKeyword ?? 'unknown'}".`);
  }

  return statement;
}

function normalizeSingleStatement(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '').trim();
  if (!trimmed) throw new Error('SQL is empty.');
  if (hasInteriorSemicolon(trimmed)) {
    throw new Error('Only one SQL statement is allowed.');
  }
  return trimmed;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function hasInteriorSemicolon(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && !inDouble) {
      if (inSingle && next === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === ';' && !inSingle && !inDouble) {
      return true;
    }
  }

  return false;
}
