/**
 * VK broadcast inline-button callback identifiers.
 *
 * Аналог broadcast-callbacks.constants.ts (TG), но СВОИ значения для VK. На каждом
 * рассылочном сообщении VK едут три callback-кнопки:
 *  - «❌ Отписаться»     (VK_BCAST_UNSUB)       → marketing_suppressions(reason='unsubscribe').
 *  - «🙋 Я не студент»   (VK_BCAST_NOT_STUDENT) → internal_note оператору (тёплый лид).
 *  - «📍 Наши адреса»    (VK_BCAST_ADDRESSES)   → snackbar/ответ с адресами студий из БД.
 *
 * ВАЖНО (контракт с vk.adapter.ts S3): адаптер при маппинге кнопок кладёт callback_data в
 * VK payload как JSON-объект `{"cmd":"<value>"}` (mapBroadcastButtonsToVkKeyboard). При
 * нажатии VK присылает в message_event поле `payload` — VK десериализует валидный JSON, так
 * что в handleVkBroadcastCallback приходит уже ОБЪЕКТ `{cmd:"<value>"}` (а не строка). На
 * всякий случай парсер ниже терпит и строку-JSON, и сырое значение `cmd`.
 *
 * Файл намеренно зависимо-лёгкий (без БД/чата), чтобы и vk.adapter (матчинг при желании), и
 * vk-broadcast-callbacks.service (обработка) импортировали его без тяжёлого графа.
 */
export const VK_BCAST_UNSUB = 'vk_unsub';
export const VK_BCAST_NOT_STUDENT = 'vk_not_student';
export const VK_BCAST_ADDRESSES = 'vk_addresses';

/** Все известные значения cmd VK-рассылки. */
const VK_BCAST_CMDS: ReadonlySet<string> = new Set([
  VK_BCAST_UNSUB,
  VK_BCAST_NOT_STUDENT,
  VK_BCAST_ADDRESSES,
]);

/**
 * Извлечь нормализованное значение cmd из VK message_event payload.
 *
 * VK присылает payload в нескольких возможных формах (зависит от клиента/версии):
 *  - объект `{cmd: "vk_unsub"}` (наш формат после mapBroadcastButtonsToVkKeyboard);
 *  - JSON-строка `'{"cmd":"vk_unsub"}'`;
 *  - голая строка `'vk_unsub'`.
 * Возвращает значение cmd ТОЛЬКО если оно из нашего набора, иначе null (чужой payload).
 */
export function parseVkBroadcastCmd(payload: unknown): string | null {
  let cmd: unknown;

  if (typeof payload === 'string') {
    // Может быть JSON-строкой `{"cmd":...}` или голым значением.
    const trimmed = payload.trim();
    if (trimmed.startsWith('{')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        cmd = obj['cmd'];
      } catch {
        cmd = trimmed;
      }
    } else {
      cmd = trimmed;
    }
  } else if (payload && typeof payload === 'object') {
    cmd = (payload as Record<string, unknown>)['cmd'];
  }

  if (typeof cmd === 'string' && VK_BCAST_CMDS.has(cmd)) return cmd;
  return null;
}

/** True, если payload принадлежит набору callback-кнопок VK-рассылки. */
export function isVkBroadcastCallback(payload: unknown): boolean {
  return parseVkBroadcastCmd(payload) !== null;
}
