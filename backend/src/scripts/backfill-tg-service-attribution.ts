/**
 * Бэкфилл атрибуции услуг для Telegram-клиентов (команда mapping-telegram-services, S4).
 *
 * Тонкая обёртка над `reconcileAttributions()` из service-attribution.service:
 *   1. печатает «до»-метрику (tier-распределение TG-контактов, заполненность);
 *   2. вызывает reconcileAttributions({ batchSize: 300 }) — orphan-fix → Tier1
 *      orders → Tier1 phone-union → Tier2 inference (батчами) → bulk-refresh кэша;
 *   3. печатает «после»-метрику + known-remainder (TG channel_users без contact_id);
 *   4. exit.
 *
 * Идемпотентен (повтор не плодит строк — ON CONFLICT в сервисе). Пишет ТОЛЬКО в
 * новые объекты (client_service_attributions + кэш-колонки contacts) — ничего
 * существующего не меняет, кроме orphan-fix channel_users.contact_id (Шаг 0).
 *
 * Запуск:  cd backend && npx tsx src/scripts/backfill-tg-service-attribution.ts
 *          (--batch <N> — размер батча Tier2-inference, по умолчанию 300)
 */

import db, { pool } from '../database/db.js';
import { reconcileAttributions } from '../services/service-attribution.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('backfill-tg-service-attribution');

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Снимок метрик для TG-подмножества (для печати «до»/«после»). */
interface Snapshot {
  tgContactsTotal: number;
  tierFilled: number;
  slugFilled: number;
  attrRows: number;
  tgOrphans: number;
  tierBreakdown: Array<{ tier: string; count: number }>;
}

async function takeSnapshot(): Promise<Snapshot> {
  const filled = await pool.query<{
    tg_contacts_total: string;
    tier_filled: string;
    slug_filled: string;
  }>(
    `SELECT count(*)                                          AS tg_contacts_total,
            count(*) FILTER (WHERE service_attribution_tier IS NOT NULL) AS tier_filled,
            count(*) FILTER (WHERE primary_service_slug IS NOT NULL)     AS slug_filled
       FROM contacts c
      WHERE EXISTS (SELECT 1 FROM channel_users cu
                     WHERE cu.contact_id = c.id AND cu.channel = 'telegram')`,
  );

  const tierRows = await pool.query<{ service_attribution_tier: string | null; count: string }>(
    `SELECT service_attribution_tier, count(*) AS count
       FROM contacts c
      WHERE EXISTS (SELECT 1 FROM channel_users cu
                     WHERE cu.contact_id = c.id AND cu.channel = 'telegram')
      GROUP BY 1
      ORDER BY 1`,
  );

  const attr = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM client_service_attributions`,
  );

  const orphans = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM channel_users
      WHERE channel = 'telegram' AND contact_id IS NULL`,
  );

  return {
    tgContactsTotal: Number(filled.rows[0].tg_contacts_total),
    tierFilled: Number(filled.rows[0].tier_filled),
    slugFilled: Number(filled.rows[0].slug_filled),
    attrRows: Number(attr.rows[0].count),
    tgOrphans: Number(orphans.rows[0].count),
    tierBreakdown: tierRows.rows.map((r) => ({
      tier: r.service_attribution_tier ?? '(null)',
      count: Number(r.count),
    })),
  };
}

/** Разбивка строк client_service_attributions по method×tier (для глаз владельца). */
async function methodTierBreakdown(): Promise<void> {
  const { rows } = await pool.query<{ method: string; tier: string; count: string }>(
    `SELECT method, tier, count(*) AS count
       FROM client_service_attributions
      GROUP BY 1, 2
      ORDER BY 1, 2`,
  );
  log.info('attribution method×tier breakdown', {
    rows: rows.map((r) => `${r.method}/${r.tier}=${r.count}`).join('  '),
  });
}

/** 15 случайных inferred-классификаций — sanity-проверка качества Tier2. */
async function sampleInferred(): Promise<void> {
  const { rows } = await pool.query<{
    service_slug: string;
    service_label: string | null;
    confidence: string;
  }>(
    `SELECT service_slug, service_label, confidence
       FROM client_service_attributions
      WHERE method = 'text_inference'
      ORDER BY random()
      LIMIT 15`,
  );
  if (rows.length === 0) {
    log.info('no text_inference rows to sample');
    return;
  }
  log.info(`inferred sample (${rows.length})`);
  for (const r of rows) {
    const label = (r.service_label ?? '').replace(/\s+/g, ' ').slice(0, 110);
    // eslint-disable-next-line no-console
    console.log(`  [${r.confidence}] ${r.service_slug.padEnd(16)} ← "${label}"`);
  }
}

function printSnapshot(tag: string, s: Snapshot): void {
  const tierPct =
    s.tgContactsTotal > 0 ? ((s.tierFilled / s.tgContactsTotal) * 100).toFixed(1) : '0.0';
  const slugPct =
    s.tgContactsTotal > 0 ? ((s.slugFilled / s.tgContactsTotal) * 100).toFixed(1) : '0.0';
  log.info(`[${tag}] TG-attribution snapshot`, {
    tgContactsTotal: s.tgContactsTotal,
    tierFilled: `${s.tierFilled} (${tierPct}%)`,
    slugFilled: `${s.slugFilled} (${slugPct}%)`,
    attributionRows: s.attrRows,
    tgChannelUsersWithoutContact: s.tgOrphans,
    tierBreakdown: s.tierBreakdown.map((t) => `${t.tier}=${t.count}`).join('  '),
  });
}

async function main(): Promise<void> {
  const batchSize = positiveInt(argValue('--batch'), 300);

  const before = await takeSnapshot();
  printSnapshot('BEFORE', before);

  log.info('running reconcileAttributions…', { batchSize });
  const started = Date.now();
  const res = await reconcileAttributions({ batchSize });
  log.info('reconcileAttributions done', {
    scanned: res.scanned,
    inserted: res.inserted,
    contactsTouched: res.contactsTouched,
    durationMs: Date.now() - started,
  });

  const after = await takeSnapshot();
  printSnapshot('AFTER', after);

  await methodTierBreakdown();
  await sampleInferred();

  const filledPct =
    after.tgContactsTotal > 0
      ? ((after.slugFilled / after.tgContactsTotal) * 100).toFixed(1)
      : '0.0';
  log.info('backfill summary', {
    tgContactsTotal: after.tgContactsTotal,
    primaryServiceFilledPct: `${filledPct}%`,
    knownRemainderTgChannelUsersWithoutContact: after.tgOrphans,
  });
}

main()
  .catch((err) => {
    log.error('backfill script failed', { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
