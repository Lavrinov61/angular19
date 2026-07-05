import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchSelectel } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';
import type { DnsZonesResponse, DnsRrsetResponse } from '../types.js';

const ZONE_MAP: Record<string, string> = {
  'svoefoto.ru': '6e4b51b7-ec83-4b63-8194-ae48200af73b',
  'dnsfoto.ru': '9cf70111-d9c1-40dd-aedc-fda77669a393',
  'fmagnus.org': '4681316d-2fcb-4b3c-9231-738d28088554',
  'fmagnus.ru': '9001e0d4-0d44-4ef1-bcf0-f86835acfc6a',
  'fotomagnus.ru': '809162e2-dadb-4581-acd0-1bd655b09077',
};

function resolveZoneId(zone: string): string | null {
  return ZONE_MAP[zone] ?? null;
}

function formatZones(zones: DnsZonesResponse['result']): string {
  if (!zones.length) return 'Нет DNS зон.';

  const lines = zones.map((z) => {
    const delegation = z.delegation_check_status ?? 'unknown';
    const disabled = z.disabled ? ' [DISABLED]' : '';
    return `  ${z.name.padEnd(25)} id=${z.uuid}  delegation=${delegation}${disabled}`;
  });

  return `DNS зоны (${zones.length}):\n${lines.join('\n')}`;
}

function formatRrsets(rrsets: DnsRrsetResponse['result'], zone: string): string {
  if (!rrsets.length) return `Нет записей для ${zone}.`;

  const lines = rrsets.map((rr) => {
    const records = rr.records
      .map((r) => (r.disabled ? `[OFF] ${r.content}` : r.content))
      .join(', ');
    return `  ${rr.type.padEnd(6)} ${rr.name.padEnd(45)} TTL=${String(rr.ttl).padEnd(6)} -> ${records}`;
  });

  return `DNS записи для ${zone} (${rrsets.length}):\n${lines.join('\n')}`;
}

export function registerDnsTools(server: McpServer): void {
  // 1. dns_list_zones
  server.tool(
    'dns_list_zones',
    'Список всех DNS зон в Selectel (id, name, delegation status)',
    {},
    async () => {
      try {
        const res = await fetchSelectel(
          'https://api.selectel.ru/domains/v2/zones?limit=50&offset=0',
          { authType: 'keystone' },
        );
        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }
        const data = (await res.json()) as DnsZonesResponse;
        return textResponse(formatZones(data.result));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. dns_list_records
  server.tool(
    'dns_list_records',
    'Список DNS записей для домена',
    { zone: z.string().describe('Домен (svoefoto.ru, dnsfoto.ru, fmagnus.org, fmagnus.ru, fotomagnus.ru)') },
    async ({ zone }) => {
      try {
        const zoneId = resolveZoneId(zone);
        if (!zoneId) {
          const known = Object.keys(ZONE_MAP).join(', ');
          return errorResponse(`Неизвестный домен: ${zone}. Известные: ${known}`);
        }
        const res = await fetchSelectel(
          `https://api.selectel.ru/domains/v2/zones/${zoneId}/rrset?limit=100&offset=0`,
          { authType: 'keystone' },
        );
        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }
        const data = (await res.json()) as DnsRrsetResponse;
        return textResponse(formatRrsets(data.result, zone));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 3. dns_create_record
  server.tool(
    'dns_create_record',
    `Создать DNS запись (A, AAAA, CNAME, MX, TXT, SRV). Requires confirm="${SELECTEL_CONFIRM.DNS_CREATE_RECORD}".`,
    {
      zone: z.string().describe('Домен (svoefoto.ru и т.д.)'),
      name: z.string().describe('Поддомен (test, www, @). Полное имя формируется автоматически'),
      type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV']).describe('Тип записи'),
      content: z.string().describe('Значение записи'),
      ttl: z.number().default(300).describe('TTL в секундах (по умолчанию 300)'),
      confirm: z.string().optional().default('').describe('Подтверждение изменения'),
    },
    async ({ zone, name, type, content, ttl, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.DNS_CREATE_RECORD, 'create a DNS record');
      if (confirmError) return confirmError;

      try {
        const zoneId = resolveZoneId(zone);
        if (!zoneId) {
          return errorResponse(`Неизвестный домен: ${zone}`);
        }

        // Build the full record name
        let fullName = name;
        if (name === '@' || name === '') {
          fullName = `${zone}.`;
        } else if (!name.endsWith('.')) {
          fullName = `${name}.${zone}.`;
        }

        const body = {
          name: fullName,
          type,
          ttl,
          records: [{ content, disabled: false }],
        };

        const res = await fetchSelectel(
          `https://api.selectel.ru/domains/v2/zones/${zoneId}/rrset`,
          {
            method: 'POST',
            authType: 'keystone',
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка создания (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        return textResponse(
          `Запись создана:\n  ${type} ${fullName} -> ${content} (TTL=${ttl})\n  ID: ${data.uuid ?? 'n/a'}`,
        );
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 4. dns_update_record
  server.tool(
    'dns_update_record',
    `Обновить DNS запись по rrset_id. Requires confirm="${SELECTEL_CONFIRM.DNS_UPDATE_RECORD}".`,
    {
      zone: z.string().describe('Домен'),
      rrset_id: z.string().describe('UUID rrset записи'),
      content: z.string().describe('Новое значение'),
      ttl: z.number().optional().describe('Новый TTL (если нужно изменить)'),
      confirm: z.string().optional().default('').describe('Подтверждение изменения'),
    },
    async ({ zone, rrset_id, content, ttl, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.DNS_UPDATE_RECORD, 'update a DNS record');
      if (confirmError) return confirmError;

      try {
        const zoneId = resolveZoneId(zone);
        if (!zoneId) {
          return errorResponse(`Неизвестный домен: ${zone}`);
        }

        const body: Record<string, unknown> = {
          records: [{ content, disabled: false }],
        };
        if (ttl !== undefined) {
          body.ttl = ttl;
        }

        const res = await fetchSelectel(
          `https://api.selectel.ru/domains/v2/zones/${zoneId}/rrset/${rrset_id}`,
          {
            method: 'PATCH',
            authType: 'keystone',
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка обновления (${res.status}): ${await res.text()}`);
        }

        return textResponse(`Запись ${rrset_id} обновлена: content=${content}${ttl ? ` ttl=${ttl}` : ''}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 5. dns_delete_record
  server.tool(
    'dns_delete_record',
    `Удалить DNS запись по rrset_id. Requires confirm="${SELECTEL_CONFIRM.DNS_DELETE_RECORD}".`,
    {
      zone: z.string().describe('Домен'),
      rrset_id: z.string().describe('UUID rrset записи'),
      confirm: z.string().optional().default('').describe('Подтверждение удаления'),
    },
    async ({ zone, rrset_id, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.DNS_DELETE_RECORD, 'delete a DNS record');
      if (confirmError) return confirmError;

      try {
        const zoneId = resolveZoneId(zone);
        if (!zoneId) {
          return errorResponse(`Неизвестный домен: ${zone}`);
        }

        const res = await fetchSelectel(
          `https://api.selectel.ru/domains/v2/zones/${zoneId}/rrset/${rrset_id}`,
          { method: 'DELETE', authType: 'keystone' },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка удаления (${res.status}): ${await res.text()}`);
        }

        return textResponse(`Запись ${rrset_id} удалена из зоны ${zone}.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 6. dns_create_zone
  server.tool(
    'dns_create_zone',
    `Создать новую DNS зону. Requires confirm="${SELECTEL_CONFIRM.DNS_CREATE_ZONE}".`,
    {
      name: z.string().describe('Доменное имя (например, example.ru)'),
      confirm: z.string().optional().default('').describe('Подтверждение создания зоны'),
    },
    async ({ name, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.DNS_CREATE_ZONE, 'create a DNS zone');
      if (confirmError) return confirmError;

      try {
        const domainName = name.endsWith('.') ? name : `${name}.`;

        const res = await fetchSelectel(
          'https://api.selectel.ru/domains/v2/zones',
          {
            method: 'POST',
            authType: 'keystone',
            body: JSON.stringify({ name: domainName }),
          },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка создания зоны (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        return textResponse(
          `Зона создана:\n  name: ${data.name}\n  id: ${data.uuid}\n  NS: укажите ns1.selectel.org, ns2.selectel.org, ns3.selectel.org, ns4.selectel.org у регистратора`,
        );
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 7. dns_delete_zone
  server.tool(
    'dns_delete_zone',
    `Удалить DNS зону (ОСТОРОЖНО!). Requires confirm="${SELECTEL_CONFIRM.DNS_DELETE_ZONE}".`,
    {
      zone: z.string().describe('Домен для удаления'),
      confirm: z.string().optional().default('').describe('Подтверждение удаления зоны'),
    },
    async ({ zone, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.DNS_DELETE_ZONE, 'delete a DNS zone');
      if (confirmError) return confirmError;

      try {
        const zoneId = resolveZoneId(zone);
        if (!zoneId) {
          return errorResponse(`Неизвестный домен: ${zone}. Удалять можно только зоны из известного списка.`);
        }

        const res = await fetchSelectel(
          `https://api.selectel.ru/domains/v2/zones/${zoneId}`,
          { method: 'DELETE', authType: 'keystone' },
        );

        if (!res.ok) {
          return errorResponse(`Ошибка удаления зоны (${res.status}): ${await res.text()}`);
        }

        return textResponse(`Зона ${zone} (${zoneId}) удалена. Все DNS записи потеряны.`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}
