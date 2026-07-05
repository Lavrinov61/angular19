import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchSelectel } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';

const DEFAULT_SERVER_UUID = '7c56ef28-97ec-43b1-a17e-c9aff0c5f735';
const DEDICATED_API = 'https://api.selectel.ru/dedicated-servers/v2';

export function registerNetworkTools(server: McpServer): void {
  // 1. network_list_ips
  server.tool(
    'network_list_ips',
    'Список IP адресов выделенного сервера',
    {
      uuid: z.string().optional().describe('UUID сервера'),
    },
    async ({ uuid }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}/networks`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const networks = Array.isArray(data) ? data : data.networks ?? data.results ?? [data];

        const lines: string[] = ['IP адреса сервера:'];
        for (const net of networks) {
          if (net.ips && Array.isArray(net.ips)) {
            for (const ip of net.ips) {
              const addr = ip.address ?? ip.ip ?? 'n/a';
              const version = ip.version ?? ip.type ?? '';
              const ptr = ip.ptr ?? ip.reverse_dns ?? '';
              lines.push(`  ${addr} (v${version})${ptr ? ` PTR: ${ptr}` : ''}`);
            }
          } else {
            const addr = net.address ?? net.ip ?? JSON.stringify(net);
            lines.push(`  ${addr}`);
          }
        }

        return textResponse(lines.join('\n'));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. network_ip_info
  server.tool(
    'network_ip_info',
    'Детали IP адреса (gateway, subnet, PTR и т.д.)',
    {
      ip: z.string().describe('IP адрес для запроса'),
      uuid: z.string().optional().describe('UUID сервера'),
    },
    async ({ ip, uuid }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}/networks`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const networks = Array.isArray(data) ? data : data.networks ?? data.results ?? [data];

        // Search for the specific IP
        for (const net of networks) {
          const ips = net.ips ?? [];
          for (const ipEntry of ips) {
            const addr = ipEntry.address ?? ipEntry.ip ?? '';
            if (addr === ip) {
              const lines = [
                `Информация об IP ${ip}:`,
                `  Адрес: ${addr}`,
                `  Версия: ${ipEntry.version ?? 'n/a'}`,
                `  Gateway: ${ipEntry.gateway ?? net.gateway ?? 'n/a'}`,
                `  Subnet: ${net.subnet ?? net.cidr ?? 'n/a'}`,
                `  Mask: ${net.mask ?? ipEntry.mask ?? 'n/a'}`,
                `  PTR: ${ipEntry.ptr ?? ipEntry.reverse_dns ?? 'не задан'}`,
                `  Network ID: ${net.id ?? 'n/a'}`,
              ];
              return textResponse(lines.join('\n'));
            }
          }
        }

        return errorResponse(`IP ${ip} не найден на сервере ${serverUuid}.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 3. network_firewall_rules
  server.tool(
    'network_firewall_rules',
    'Правила firewall сети сервера',
    {
      uuid: z.string().optional().describe('UUID сервера'),
    },
    async ({ uuid }) => {
      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}/networks`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const networks = Array.isArray(data) ? data : data.networks ?? data.results ?? [data];

        const lines: string[] = ['Firewall правила:'];
        let foundRules = false;

        for (const net of networks) {
          const rules = net.firewall_rules ?? net.rules ?? [];
          if (rules.length > 0) {
            foundRules = true;
            lines.push(`\n  Сеть: ${net.id ?? net.subnet ?? 'n/a'}`);
            for (const rule of rules) {
              const direction = rule.direction ?? '';
              const protocol = rule.protocol ?? '';
              const port = rule.port ?? rule.dst_port ?? '';
              const src = rule.source ?? rule.src ?? '';
              const action = rule.action ?? '';
              lines.push(`    ${action.toUpperCase()} ${direction} ${protocol}${port ? `:${port}` : ''} ${src ? `from ${src}` : ''}`);
            }
          }
        }

        if (!foundRules) {
          lines.push('  Нет firewall правил (управляется на уровне ОС через UFW/iptables).');
        }

        return textResponse(lines.join('\n'));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 4. network_update_ptr
  server.tool(
    'network_update_ptr',
    `Обновить PTR запись для IP адреса. Requires confirm="${SELECTEL_CONFIRM.NETWORK_UPDATE_PTR}".`,
    {
      uuid: z.string().optional().describe('UUID сервера'),
      ptr: z.string().describe('Новое значение PTR (например, server.svoefoto.ru)'),
      confirm: z.string().optional().default('').describe('Подтверждение изменения PTR'),
    },
    async ({ uuid, ptr, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.NETWORK_UPDATE_PTR, 'update PTR');
      if (confirmError) return confirmError;

      try {
        const serverUuid = uuid ?? DEFAULT_SERVER_UUID;
        const res = await fetchSelectel(`${DEDICATED_API}/resource/${serverUuid}`, {
          method: 'PUT',
          authType: 'xtoken',
          body: JSON.stringify({ user_desc: ptr }),
        });

        if (!res.ok) {
          return errorResponse(`Ошибка обновления PTR (${res.status}): ${await res.text()}`);
        }

        return textResponse(`PTR обновлён на: ${ptr}\nПримечание: изменение PTR может занять до 24 часов для полного распространения.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}
