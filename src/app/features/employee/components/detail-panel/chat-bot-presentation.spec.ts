import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Bot chat message presentation source contract', () => {
  const readSource = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

  const chatDetailScss = readSource('src/app/features/employee/components/detail-panel/chat-detail.component.scss');
  const chatDetailTs = readSource('src/app/features/employee/components/detail-panel/chat-detail.component.ts');
  const orderMiniChatTs = readSource('src/app/features/employee/components/detail-panel/order-mini-chat.component.ts');

  it('keeps bot messages on the outgoing side in the main chat with distinct bot styling', () => {
    expect(chatDetailScss).toContain('&.bot { align-self: flex-end; flex-direction: row-reverse; }');
    expect(chatDetailScss).toContain(`.bot .bot-avatar {
  order: 1;
}`);
    expect(chatDetailScss).toContain('background: rgba(37, 99, 235, 0.18);');
    expect(chatDetailScss).toContain('border-right: 3px solid #60a5fa;');
    expect(chatDetailScss).toContain('.bot-avatar mat-icon { color: #93c5fd; }');
    expect(chatDetailScss).toContain('.bot & { color: #93c5fd; }');
    expect(chatDetailScss).toContain('.bot.grouped &');
  });

  it('keeps bot messages on the outgoing side in the order mini chat with distinct bot styling', () => {
    expect(orderMiniChatTs).toContain(`[class.mc-msg--out]="msg.sender_type === 'operator' || msg.sender_type === 'bot'"`);
    expect(orderMiniChatTs).toContain(`[class.mc-msg--bot]="msg.sender_type === 'bot'"`);
    expect(orderMiniChatTs).toContain('&.mc-msg--bot');
    expect(orderMiniChatTs).toContain('background: rgba(37, 99, 235, 0.18);');
    expect(orderMiniChatTs).toContain('border-right: 3px solid #60a5fa;');
    expect(orderMiniChatTs).toContain('color: #93c5fd;');
  });

  it('loads order mini chat session metadata from the admin detail endpoint', () => {
    expect(orderMiniChatTs).toContain('/api/visitor-chat/admin/sessions/${sessionId}/detail');
    expect(orderMiniChatTs).not.toContain('/api/visitor-chat/admin/sessions/${sessionId}`');
  });

  it('labels AI replies separately from automatic system bot messages', () => {
    expect(chatDetailTs).toContain('Искусственный интеллект');
    expect(chatDetailTs).toContain('Автоматическое сообщение');
    expect(chatDetailTs).not.toContain("if (msg.sender_type === 'bot') return 'Бот';");
    expect(chatDetailTs).toContain('isAiAssistantMessage(msg)');
    expect(orderMiniChatTs).toContain('botSenderLabel(msg)');
    expect(orderMiniChatTs).toContain('Искусственный интеллект');
    expect(orderMiniChatTs).toContain('Автоматическое сообщение');
    expect(orderMiniChatTs).not.toContain('<span class="mc-sender mc-sender--bot">Бот</span>');
  });
});
