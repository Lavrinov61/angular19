import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchSelectel } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';

const TICKETS_API = 'https://api.selectel.ru/v1/support/tickets';

export function registerTicketTools(server: McpServer): void {
  // 1. tickets_list
  server.tool(
    'tickets_list',
    'Список тикетов техподдержки Selectel',
    {
      page: z.number().default(1).describe('Страница (по умолчанию 1)'),
      is_only_opened: z.boolean().default(false).describe('Только открытые тикеты'),
    },
    async ({ page, is_only_opened }) => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          ...(is_only_opened ? { status: 'open' } : {}),
        });

        const res = await fetchSelectel(`${TICKETS_API}?${params}`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const tickets = data.results ?? data.tickets ?? data ?? [];

        if (!Array.isArray(tickets) || tickets.length === 0) {
          return textResponse('Нет тикетов.');
        }

        const lines = tickets.map((t: Record<string, unknown>) => {
          const num = t.number ?? t.id ?? '';
          const summary = t.summary ?? t.subject ?? t.title ?? '';
          const status = t.status ?? '';
          const date = t.created_at ?? t.created ?? '';
          return `  #${num} [${status}] ${summary}  (${date})`;
        });

        const total = data.count ?? tickets.length;
        return textResponse(`Тикеты (${total}, стр. ${page}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. tickets_create
  server.tool(
    'tickets_create',
    `Создать тикет в техподдержку Selectel. Requires confirm="${SELECTEL_CONFIRM.TICKET_CREATE}".`,
    {
      summary: z.string().describe('Тема тикета'),
      body: z.string().describe('Текст обращения'),
      confirm: z.string().optional().default('').describe('Подтверждение создания тикета'),
    },
    async ({ summary, body, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.TICKET_CREATE, 'create a support ticket');
      if (confirmError) return confirmError;

      try {
        const res = await fetchSelectel(TICKETS_API, {
          method: 'POST',
          authType: 'xtoken',
          body: JSON.stringify({ summary, body }),
        });

        if (!res.ok) {
          return errorResponse(`Ошибка создания тикета (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const num = data.number ?? data.id ?? 'n/a';
        return textResponse(
          `Тикет создан:\n  Номер: #${num}\n  Тема: ${summary}\n  Статус: open\n\nОжидайте ответа от поддержки Selectel.`,
        );
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 3. tickets_get
  server.tool(
    'tickets_get',
    'Детали тикета техподдержки (с комментариями)',
    {
      number: z.string().describe('Номер тикета'),
    },
    async ({ number }) => {
      try {
        const res = await fetchSelectel(`${TICKETS_API}/${number}`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const lines = [
          `Тикет #${data.number ?? number}:`,
          `  Тема: ${data.summary ?? data.subject ?? 'n/a'}`,
          `  Статус: ${data.status ?? 'n/a'}`,
          `  Создан: ${data.created_at ?? data.created ?? 'n/a'}`,
          `  Обновлён: ${data.updated_at ?? data.updated ?? 'n/a'}`,
          '',
          'Описание:',
          `  ${data.body ?? data.description ?? 'n/a'}`,
        ];

        const comments = data.comments ?? data.replies ?? [];
        if (Array.isArray(comments) && comments.length > 0) {
          lines.push('', `Комментарии (${comments.length}):`);
          for (const c of comments) {
            const author = (c as Record<string, unknown>).author ?? (c as Record<string, unknown>).user ?? 'n/a';
            const date = (c as Record<string, unknown>).created_at ?? (c as Record<string, unknown>).created ?? '';
            const text = (c as Record<string, unknown>).body ?? (c as Record<string, unknown>).text ?? '';
            lines.push(`  --- ${author} (${date}) ---`);
            lines.push(`  ${text}`);
          }
        }

        return textResponse(lines.join('\n'));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 4. tickets_comment
  server.tool(
    'tickets_comment',
    `Добавить комментарий к тикету. Requires confirm="${SELECTEL_CONFIRM.TICKET_COMMENT}".`,
    {
      ticket_number: z.string().describe('Номер тикета'),
      body: z.string().describe('Текст комментария'),
      confirm: z.string().optional().default('').describe('Подтверждение отправки комментария'),
    },
    async ({ ticket_number, body, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.TICKET_COMMENT, 'comment on a support ticket');
      if (confirmError) return confirmError;

      try {
        const res = await fetchSelectel(`${TICKETS_API}/${ticket_number}/comments`, {
          method: 'POST',
          authType: 'xtoken',
          body: JSON.stringify({ body }),
        });

        if (!res.ok) {
          return errorResponse(`Ошибка (${res.status}): ${await res.text()}`);
        }

        return textResponse(`Комментарий добавлен к тикету #${ticket_number}.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 5. tickets_close
  server.tool(
    'tickets_close',
    `Закрыть тикет техподдержки. Requires confirm="${SELECTEL_CONFIRM.TICKET_CLOSE}".`,
    {
      ticket_number: z.string().describe('Номер тикета'),
      confirm: z.string().optional().default('').describe('Подтверждение закрытия'),
    },
    async ({ ticket_number, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.TICKET_CLOSE, 'close a support ticket');
      if (confirmError) return confirmError;

      try {
        const res = await fetchSelectel(`${TICKETS_API}/${ticket_number}/close`, {
          method: 'POST',
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка закрытия (${res.status}): ${await res.text()}`);
        }

        return textResponse(`Тикет #${ticket_number} закрыт.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}
