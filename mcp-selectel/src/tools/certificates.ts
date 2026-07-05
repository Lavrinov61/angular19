import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getKeystoneToken } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';
import { z } from 'zod';

const BASE = 'https://api.selectel.ru/certificates/v1';

async function certFetch(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const token = await getKeystoneToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-Auth-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function registerCertificateTools(server: McpServer) {

  server.tool(
    'cert_list',
    'Список TLS/SSL сертификатов (пользовательские + Let\'s Encrypt)',
    {},
    async () => {
      try {
        const data = await certFetch('/certificates') as any;
        const certs = data.certificates || data.result || data || [];
        if (!Array.isArray(certs) || !certs.length) return textResponse('Нет сертификатов');
        const lines = certs.map((c: any) =>
          `[${c.id}] ${c.name || c.common_name || '?'} — ${c.type || '?'}, expires: ${c.valid_to || c.not_after || '?'}`
        );
        return textResponse(lines.join('\n'));
      } catch (e: unknown) {
        return errorResponse(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'cert_info',
    'Детали сертификата',
    { cert_id: z.string().describe('ID сертификата') },
    async ({ cert_id }) => {
      try {
        const data = await certFetch(`/certificates/${cert_id}`) as any;
        return textResponse(JSON.stringify(data, null, 2));
      } catch (e: unknown) {
        return errorResponse(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'cert_upload',
    `Загрузить персональный TLS/SSL сертификат. Requires confirm="${SELECTEL_CONFIRM.CERT_UPLOAD}".`,
    {
      name: z.string().describe('Имя сертификата'),
      certificate: z.string().describe('PEM сертификат (BEGIN CERTIFICATE...END CERTIFICATE)'),
      private_key: z.string().describe('PEM приватный ключ (BEGIN PRIVATE KEY...END PRIVATE KEY)'),
      confirm: z.string().optional().default('').describe('Подтверждение загрузки'),
    },
    async ({ name, certificate, private_key, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.CERT_UPLOAD, 'upload a certificate');
      if (confirmError) return confirmError;

      try {
        const data = await certFetch('/certificates', 'POST', {
          name,
          certificate,
          private_key,
        }) as any;
        return textResponse(`Сертификат загружен: ${data.id || 'OK'}`);
      } catch (e: unknown) {
        return errorResponse(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'cert_delete',
    `Удалить сертификат. Requires confirm="${SELECTEL_CONFIRM.CERT_DELETE}".`,
    {
      cert_id: z.string().describe('ID сертификата'),
      confirm: z.string().optional().default('').describe('Подтверждение удаления'),
    },
    async ({ cert_id, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.CERT_DELETE, 'delete a certificate');
      if (confirmError) return confirmError;

      try {
        await certFetch(`/certificates/${cert_id}`, 'DELETE');
        return textResponse(`Сертификат ${cert_id} удалён`);
      } catch (e: unknown) {
        return errorResponse(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // === Let's Encrypt ===

  server.tool(
    'cert_letsencrypt_list',
    'Список Let\'s Encrypt сертификатов',
    {},
    async () => {
      try {
        const data = await certFetch('/letsencrypt') as any;
        const certs = data.certificates || data.result || data || [];
        if (!Array.isArray(certs) || !certs.length) return textResponse('Нет Let\'s Encrypt сертификатов');
        const lines = certs.map((c: any) =>
          `[${c.id}] ${c.domains?.join(', ') || c.common_name || '?'} — status: ${c.status || '?'}, expires: ${c.valid_to || '?'}`
        );
        return textResponse(lines.join('\n'));
      } catch (e: unknown) {
        return errorResponse(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  server.tool(
    'cert_letsencrypt_issue',
    `Выпустить Let's Encrypt сертификат для домена. Requires confirm="${SELECTEL_CONFIRM.LETSENCRYPT_ISSUE}".`,
    {
      domains: z.array(z.string()).describe('Список доменов для сертификата'),
      confirm: z.string().optional().default('').describe('Подтверждение выпуска'),
    },
    async ({ domains, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.LETSENCRYPT_ISSUE, 'issue a Let\'s Encrypt certificate');
      if (confirmError) return confirmError;

      try {
        const data = await certFetch('/letsencrypt', 'POST', { domains }) as any;
        return textResponse(`Let's Encrypt сертификат запрошен: ${data.id || 'OK'}\nДомены: ${domains.join(', ')}`);
      } catch (e: unknown) {
        return errorResponse(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}
