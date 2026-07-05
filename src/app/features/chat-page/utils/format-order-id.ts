/**
 * Форматирует ID заказа в человекочитаемый вид.
 *
 * Примеры:
 *   chat-c6379813-53be-438f-ab3c-d9554ce6aa2d-1030  →  №1030
 *   WI-260228-A7K3  →  WI-A7K3
 *   PP-260228-A7K3  →  PP-A7K3
 *   <любой другой>  →  последние 8 символов
 */
export function formatOrderId(orderId: string): string {
  if (!orderId) return '-';

  // chat-{UUID}-{number} → №{number}
  if (orderId.startsWith('chat-')) {
    const parts = orderId.split('-');
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return `№${last}`;
  }

  // XX-YYMMDD-XXXX → XX-XXXX (убираем сегмент с датой)
  const prefixMatch = orderId.match(/^([A-Za-z]{2,3})-\d{6}-([A-Z0-9]+)$/i);
  if (prefixMatch) {
    return `${prefixMatch[1].toUpperCase()}-${prefixMatch[2].toUpperCase()}`;
  }

  // fallback → последние 8 символов
  return orderId.slice(-8).toUpperCase();
}
