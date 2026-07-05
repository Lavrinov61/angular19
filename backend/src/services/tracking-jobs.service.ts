/**
 * tracking-jobs.service.ts — async visitor_session update job body.
 *
 * Идемпотентный UPSERT на UNIQUE index `idx_visitor_sessions_ident`:
 *   (COALESCE(visitor_id::text, ''), COALESCE(fingerprint_visitor_id, '')).
 *
 * Вызывается BullMQ worker'ом из visitor-session-worker.ts.
 */

import { mpQuery } from '../database/mp-db.js';
import { createLogger } from '../utils/logger.js';
import { visitorSessionsUpdatedTotal } from './metrics.service.js';

const log = createLogger('tracking-jobs');

export interface VisitorSessionJobData {
  type: 'update';
  visitor_id?: string | null;
  fingerprint_visitor_id?: string | null;
  replay_session_id?: string | null;
  device_fingerprint?: string | null;
  tracking?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export async function updateVisitorSessionJob(data: VisitorSessionJobData): Promise<void> {
  const visitorId = data.visitor_id ?? null;
  const fingerprintId = data.fingerprint_visitor_id ?? null;

  if (!visitorId && !fingerprintId) {
    visitorSessionsUpdatedTotal.inc({ result: 'skipped_no_id', operation: 'none' });
    return;
  }

  try {
    // visitor_id is NOT NULL in schema — fallback to gen_random_uuid() when каллер
    // передал только fingerprint_visitor_id. UNIQUE index учитывает COALESCE,
    // поэтому повторные клики того же fingerprint без visitor_id не дублируются.
    const rows = await mpQuery<{ was_conflict: boolean }>(`
      INSERT INTO visitor_sessions (
        visitor_id, fingerprint_visitor_id, posthog_distinct_id, device_fingerprint,
        first_tracking, first_utm_source, first_utm_medium,
        first_utm_campaign, first_utm_content, first_utm_term, first_clicked_at,
        last_tracking, last_utm_source, last_utm_medium,
        last_utm_campaign, last_utm_content, last_utm_term,
        last_clicked_at, last_visit_at,
        total_clicks, created_at, updated_at
      ) VALUES (
        COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4,
        $5, $6, $7, $8, $9, $10, NOW(),
        $5, $6, $7, $8, $9, $10,
        NOW(), NOW(),
        1, NOW(), NOW()
      )
      ON CONFLICT ((COALESCE(visitor_id::text, '')), (COALESCE(fingerprint_visitor_id, ''))) DO UPDATE SET
        fingerprint_visitor_id = COALESCE(visitor_sessions.fingerprint_visitor_id, EXCLUDED.fingerprint_visitor_id),
        posthog_distinct_id    = COALESCE(visitor_sessions.posthog_distinct_id, EXCLUDED.posthog_distinct_id),
        device_fingerprint     = COALESCE(EXCLUDED.device_fingerprint, visitor_sessions.device_fingerprint),
        last_tracking          = EXCLUDED.last_tracking,
        last_utm_source        = EXCLUDED.last_utm_source,
        last_utm_medium        = EXCLUDED.last_utm_medium,
        last_utm_campaign      = EXCLUDED.last_utm_campaign,
        last_utm_content       = EXCLUDED.last_utm_content,
        last_utm_term          = EXCLUDED.last_utm_term,
        last_clicked_at        = NOW(),
        last_visit_at          = NOW(),
        total_clicks           = visitor_sessions.total_clicks + 1,
        updated_at             = NOW()
      RETURNING (xmax <> 0) AS was_conflict
    `, [
      visitorId,
      fingerprintId,
      data.replay_session_id ?? null,
      data.device_fingerprint ?? null,
      data.tracking ?? null,
      data.utm_source ?? null,
      data.utm_medium ?? null,
      data.utm_campaign ?? null,
      data.utm_content ?? null,
      data.utm_term ?? null,
    ]);

    const operation = rows?.[0]?.was_conflict ? 'update' : 'insert';
    visitorSessionsUpdatedTotal.inc({ result: 'ok', operation });
  } catch (err) {
    visitorSessionsUpdatedTotal.inc({ result: 'error', operation: 'unknown' });
    log.error('updateVisitorSessionJob failed', {
      error: err instanceof Error ? err.message : String(err),
      visitorId,
      fingerprintId,
    });
    throw err;
  }
}
