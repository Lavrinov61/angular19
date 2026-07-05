/**
 * Резолв текущей открытой POS-смены студии (любой кассир).
 *
 * Используется при оформлении чека по осиротевшей оплате без snapshot: shiftId
 * берётся не из снимка корзины, а из живой открытой смены студии. Вынесено в
 * отдельный модуль, чтобы переиспользовать без дублирования SQL.
 */

import db from '../database/db.js';

const OPEN_SHIFT_STATUS = 'open';

/** id текущей открытой POS-смены студии или null, если открытой смены нет. */
export async function findOpenShiftIdForStudio(studioId: string): Promise<string | null> {
  const row = await db.queryOne<{ id: string }>(
    `SELECT id FROM pos_shifts
      WHERE studio_id = $1 AND status = $2
      ORDER BY opened_at DESC
      LIMIT 1`,
    [studioId, OPEN_SHIFT_STATUS],
  );
  return row?.id ?? null;
}
