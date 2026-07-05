import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchSelectel } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';

const DEFAULT_SERVER_UUID = '7c56ef28-97ec-43b1-a17e-c9aff0c5f735';
const DEDICATED_API = 'https://api.selectel.ru/dedicated-servers/v2';

function formatServerInfo(data: Record<string, unknown>): string {
  const lines: string[] = ['=== Dedicated Server ==='];

  const addField = (label: string, value: unknown) => {
    if (value !== undefined && value !== null) {
      lines.push(`  ${label}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  };

  addField('ID', data.id);
  addField('UUID', data.resource_uuid);
  addField('Name', data.name);
  addField('Status', data.status);
  addField('Location', data.location);

  if (data.configuration && typeof data.configuration === 'object') {
    lines.push('  --- Конфигурация ---');
    const config = data.configuration as Record<string, unknown>;
    for (const [key, val] of Object.entries(config)) {
      addField(`    ${key}`, val);
    }
  }

  if (data.billing && typeof data.billing === 'object') {
    lines.push('  --- Биллинг ---');
    const billing = data.billing as Record<string, unknown>;
    for (const [key, val] of Object.entries(billing)) {
      addField(`    ${key}`, val);
    }
  }

  if (data.network && typeof data.network === 'object') {
    lines.push('  --- Сеть ---');
    const network = data.network as Record<string, unknown>;
    for (const [key, val] of Object.entries(network)) {
      addField(`    ${key}`, val);
    }
  }

  return lines.join('\n');
}

export function registerServerTools(server: McpServer): void {
  // 1. server_info
  server.tool(
    'server_info',
    'Информация о выделенном сервере Selectel (конфигурация, биллинг, статус)',
    {
      uuid: z.string().optional().describe(`UUID сервера (по умолчанию ${DEFAULT_SERVER_UUID})`),
    },
    async ({ uuid }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        return textResponse(formatServerInfo(data));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. server_power_status
  server.tool(
    'server_power_status',
    'Состояние питания выделенного сервера',
    {
      uuid: z.string().optional().describe('UUID сервера'),
    },
    async ({ uuid }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}/power_status`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const status = data.power_status ?? data.status ?? JSON.stringify(data);
        return textResponse(`Питание сервера: ${status}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 3. server_reboot
  server.tool(
    'server_reboot',
    `Перезагрузка выделенного сервера. Requires confirm="${SELECTEL_CONFIRM.SERVER_REBOOT}".`,
    {
      uuid: z.string().optional().describe('UUID сервера'),
      confirm: z.string().optional().default('').describe('Подтверждение перезагрузки'),
    },
    async ({ uuid, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.SERVER_REBOOT, 'reboot the dedicated server');
      if (confirmError) return confirmError;

      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}/reboot`, {
          method: 'POST',
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка перезагрузки (${res.status}): ${await res.text()}`);
        }

        return textResponse('Перезагрузка сервера инициирована. Ожидайте ~2-5 минут до полной доступности.');
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 4. server_traffic
  server.tool(
    'server_traffic',
    'Трафик выделенного сервера за месяц',
    {
      uuid: z.string().optional().describe('UUID сервера'),
      month: z.string().optional().describe('Месяц в формате YYYY-MM (по умолчанию текущий)'),
    },
    async ({ uuid, month }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const targetMonth = month ?? new Date().toISOString().slice(0, 7);
        const res = await fetchSelectel(
          `${DEDICATED_API}/resource/${serverUuid}/traffic?month=${targetMonth}`,
          { authType: 'xtoken' },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();

        if (Array.isArray(data)) {
          const lines = data.map((item: Record<string, unknown>) => {
            const incoming = Number(item.incoming_bytes ?? 0);
            const outgoing = Number(item.outgoing_bytes ?? 0);
            return `  ${item.date ?? 'n/a'}: IN=${formatBytes(incoming)} OUT=${formatBytes(outgoing)}`;
          });
          return textResponse(`Трафик за ${targetMonth}:\n${lines.join('\n')}`);
        }

        // Single summary object
        const incoming = Number(data.incoming_bytes ?? data.incoming ?? 0);
        const outgoing = Number(data.outgoing_bytes ?? data.outgoing ?? 0);
        return textResponse(
          `Трафик за ${targetMonth}:\n  Входящий: ${formatBytes(incoming)}\n  Исходящий: ${formatBytes(outgoing)}\n  Всего: ${formatBytes(incoming + outgoing)}`,
        );
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 5. server_events
  server.tool(
    'server_events',
    'Последние события сервера (перезагрузки, изменения и т.д.)',
    {
      uuid: z.string().optional().describe('UUID сервера'),
      limit: z.number().default(20).describe('Количество событий (по умолчанию 20)'),
    },
    async ({ uuid, limit }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(
          `${DEDICATED_API}/resource/${serverUuid}/events?limit=${limit}`,
          { authType: 'xtoken' },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const events = Array.isArray(data) ? data : data.events ?? data.results ?? [];

        if (!events.length) {
          return textResponse('Нет событий.');
        }

        const lines = events.map((evt: Record<string, unknown>) => {
          const date = evt.created_at ?? evt.date ?? '';
          const type = evt.type ?? evt.event_type ?? '';
          const desc = evt.description ?? evt.message ?? '';
          return `  [${date}] ${type}: ${desc}`;
        });

        return textResponse(`События сервера (последние ${events.length}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}
