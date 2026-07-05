/**
 * studio-status.service — единый источник ЭФФЕКТИВНОГО статуса студий «на сегодня».
 *
 * studios.status_until — последний закрытый день ВКЛЮЧИТЕЛЬНО; начиная со
 * следующего дня студия снова считается открытой (та же логика, что в
 * booking-autonomous.selectStudioEffectiveStatus, только для текущей даты по
 * Москве и сразу для всех студий). Благодаря этому временное закрытие
 * «само истекает»: ставим status='closed' + status_until, и в день после
 * status_until все потребители (ИИ-бот, чат-кнопки, маршрутизация
 * производства) автоматически возвращаются к открытой точке без ручного отката.
 *
 * Постоянно закрытые публичные точки не входят в STUDIO_SHORT_LABELS, чтобы
 * клиентские pickup-инструменты их не предлагали. Но они входят в
 * STUDIO_AI_CONTEXT_LABELS, чтобы бот мог отвечать на прямые вопросы о старом
 * адресе по актуальному статусу из БД.
 *
 * Потребители: ai-agent-tools (list_pickup_points, create_print_order_draft),
 * ai-agent-orchestrator (подсказка в системный промпт), chat-bot-engine
 * (кнопки самовывоза + точка производства при доставке).
 */

import db from '../database/db.js';

export type StudioEffectiveStatus = 'open' | 'closed' | 'maintenance';

export interface StudioStatusRow {
  id: string;
  name: string;
  location_code: string | null;
  address: string | null;
  status: StudioEffectiveStatus;
  status_message: string | null;
  status_until: string | null; // 'YYYY-MM-DD' или null
}

/**
 * Короткие витринные ярлыки физических точек по location_code. Совпадают со
 * строками, которые исторически используют чат-движок и ai-agent (STUDIO_LABELS),
 * чтобы фильтрация по статусу не разъезжалась с подписями кнопок/заказов.
 */
export const STUDIO_SHORT_LABELS: Record<string, string> = {
  soborny: 'Соборный 21',
};

/**
 * Витринные ярлыки всех известных адресов для AI-контекста.
 * Соборный публичен и доступен, Баррикадная историческая и закрытая для клиентов,
 * но должна попадать в prompt как закрытый адрес из БД.
 */
export const STUDIO_AI_CONTEXT_LABELS: Record<string, string> = {
  ...STUDIO_SHORT_LABELS,
  'barrikadnaya-4': '2-ая Баррикадная 4',
};

/** Адреса, которые AI должен знать из БД, включая закрытые исторические точки. */
const AI_CONTEXT_LOCATION_CODES = Object.keys(STUDIO_AI_CONTEXT_LABELS);
const RETIRED_STUDIO_LABELS = new Set(['2-я Баррикадная 4', '2-ая Баррикадная 4']);

/**
 * Эффективный статус всех физических студий на текущую дату по Москве.
 * status/status_message «гаснут» в open/NULL для дат строго после status_until.
 */
export async function getStudiosEffectiveStatus(): Promise<StudioStatusRow[]> {
  return db.query<StudioStatusRow>(
    `SELECT id::text AS id, name, location_code, address,
        CASE WHEN status_until IS NOT NULL
                  AND status_until < (NOW() AT TIME ZONE 'Europe/Moscow')::date
             THEN 'open' ELSE status END AS status,
        CASE WHEN status_until IS NOT NULL
                  AND status_until < (NOW() AT TIME ZONE 'Europe/Moscow')::date
             THEN NULL ELSE status_message END AS status_message,
        to_char(status_until, 'YYYY-MM-DD') AS status_until
       FROM studios
      WHERE location_code = ANY($1::text[])
      ORDER BY name`,
    [AI_CONTEXT_LOCATION_CODES],
  );
}

function isOpen(row: StudioStatusRow): boolean {
  return row.status === 'open';
}

/** Открыта ли публичная точка с данным коротким ярлыком ('Соборный 21'). */
export async function isStudioLabelOpen(label: string): Promise<boolean> {
  if (RETIRED_STUDIO_LABELS.has(label)) return false;
  const rows = await getStudiosEffectiveStatus();
  const row = rows.find(r => r.location_code && STUDIO_SHORT_LABELS[r.location_code] === label);
  // Неизвестный ярлык не блокируем (fail-open для подписей вне нашего справочника).
  return row ? isOpen(row) : true;
}

/**
 * Возвращает ярлык открытой точки производства/самовывоза. Если preferred открыта
 * (или неизвестна нашему справочнику) — отдаём её; иначе подменяем на первую
 * открытую физическую точку (приоритет Соборному как центральной). Если открытых
 * нет — отдаём preferred как есть (не маскируем полное отсутствие точек).
 */
export async function resolveOpenProductionLabel(preferredLabel: string): Promise<string> {
  const rows = await getStudiosEffectiveStatus();
  const preferred = rows.find(r => r.location_code && STUDIO_SHORT_LABELS[r.location_code] === preferredLabel);
  if (!RETIRED_STUDIO_LABELS.has(preferredLabel) && (!preferred || isOpen(preferred))) return preferredLabel;

  const openRows = rows.filter(isOpen);
  const soborny = openRows.find(r => r.location_code === 'soborny');
  const fallback = soborny ?? openRows[0];
  return fallback?.location_code ? STUDIO_SHORT_LABELS[fallback.location_code] : preferredLabel;
}
