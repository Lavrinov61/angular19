/**
 * Forward-capture хелпер для FC-1 (создание заказа) — slice S5,
 * команда mapping-telegram-services.
 *
 * Общая best-effort обвязка вокруг `attributeOrder` из service-attribution.service:
 *   1. attributeOrder(orderUuid)            — пишет fact-атрибуции по items заказа.
 *   2. selected_service на беседе           — денорм для CRM/виджета (только если пуст).
 *   3. telegram_user_id на заказе           — из conversations.external_chat_id (DM).
 *
 * Всё под общим try/catch — падение НЕ должно влиять на ответ заказа (как
 * существующие `.catch(log.warn)` в contact.service). Вызывать ПОСЛЕ успешного
 * INSERT/COMMIT заказа, вне транзакции заказа.
 *
 * Резолв contact идёт через `chat_session_id → conversations.contact_id`
 * (photo_print_orders не имеет прямого contact_id). Walk-in без беседы →
 * нечего проставлять (known gap, см. 30-architecture P1-1).
 *
 * NB: chat-заказы хранят items как free-text `{service:displayService}`. Их
 * нормализация — задача `normalizeServiceOption` (S2, читает ключ `service`),
 * после чего `attributeOrder` покрывает chat-заказы автоматически. S5 НЕ пишет
 * атрибуцию вручную (единая точка = attributeOrder).
 */

import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { attributeOrder } from './service-attribution.service.js';

const log = createLogger('service-attribution-forward');

interface ConvForwardRow {
  contact_id: string | null;
  channel: string | null;
  external_chat_id: string | null;
  primary_service_slug: string | null;
}

/**
 * FC-1: атрибутировать только что созданный заказ + проставить денорм-поля.
 *
 * @param orderUuid     внутренний `photo_print_orders.id` (UUID, НЕ текстовый order_id).
 * @param chatSessionId `photo_print_orders.chat_session_id` (UUID беседы) или null/undefined.
 *
 * Best-effort: любые ошибки логируются и проглатываются.
 */
export async function captureOrderServiceAttribution(
  orderUuid: string,
  chatSessionId: string | null | undefined,
): Promise<void> {
  try {
    // 1. Записать fact-атрибуции по items заказа (сам резолвит contact + refresh кэша).
    //    structured items (CRM) и chat free-text (после расширения normalizeServiceOption).
    await attributeOrder(orderUuid);

    if (!chatSessionId) return; // walk-in/CRM без беседы — selected_service/tg_user_id некуда писать.

    // 2+3. Прочитать беседу + актуальный primary_service контакта (его обновил attributeOrder).
    const { rows } = await pool.query<ConvForwardRow>(
      `SELECT conv.contact_id,
              conv.channel::text       AS channel,
              conv.external_chat_id,
              c.primary_service_slug
       FROM conversations conv
       LEFT JOIN contacts c ON c.id = conv.contact_id
       WHERE conv.id = $1`,
      [chatSessionId],
    );
    const conv = rows[0];
    if (!conv) return;

    // 2. selected_service — денорм основной услуги на беседу (только если ещё пусто).
    //    Берём primary_service_slug контакта (детерминированный primary из refreshPrimaryService).
    if (conv.primary_service_slug && conv.primary_service_slug !== 'not_determined') {
      await pool.query(
        `UPDATE conversations
            SET selected_service = $1
          WHERE id = $2 AND selected_service IS NULL`,
        [conv.primary_service_slug, chatSessionId],
      );
    }

    // 3. telegram_user_id на заказе — для DM (external_chat_id числовой == tg user_id).
    //    Группы (external_chat_id < 0) и не-telegram пропускаем.
    if (conv.channel === 'telegram' && conv.external_chat_id && /^\d+$/.test(conv.external_chat_id)) {
      await pool.query(
        `UPDATE photo_print_orders
            SET telegram_user_id = $1::bigint
          WHERE id = $2 AND telegram_user_id IS NULL`,
        [conv.external_chat_id, orderUuid],
      );
    }
  } catch (err) {
    log.warn('captureOrderServiceAttribution failed', {
      orderUuid,
      chatSessionId: chatSessionId ?? null,
      error: String(err),
    });
  }
}
