/**
 * Chat welcome service — генерация приветственных сообщений и интерактивных меню.
 *
 * Приветственное сообщение для новых клиентов убрано для ускорения /chat (FCP).
 * Клиент видит placeholder "Напишите, что вам нужно..." в поле ввода.
 */

import type { BotInteractive, VisitorSession } from './chat-shared.js';

export type { VisitorSession };

export async function generateWelcomeMessage(_session: VisitorSession): Promise<string | null> {
  return null;
}

export function generateWelcomeInteractive(_session: VisitorSession): BotInteractive | undefined {
  return undefined;
}
