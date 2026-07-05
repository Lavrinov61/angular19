import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchSelectel } from '../auth.js';
import { textResponse, errorResponse } from '../types.js';

const IAM_API = 'https://api.selectel.ru/iam/v1';

export function registerIamTools(server: McpServer): void {
  // 1. iam_list_users
  server.tool(
    'iam_list_users',
    'Список пользователей аккаунта Selectel',
    {},
    async () => {
      try {
        const res = await fetchSelectel(`${IAM_API}/users`, {
          authType: 'keystone',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const users = data.users ?? data.results ?? data ?? [];

        if (!Array.isArray(users) || users.length === 0) {
          return textResponse('Нет пользователей.');
        }

        const lines = users.map((u: Record<string, unknown>) => {
          const name = u.name ?? u.login ?? u.email ?? 'n/a';
          const id = u.id ?? u.user_id ?? '';
          const role = u.role ?? u.roles ?? '';
          const enabled = u.enabled !== false ? 'active' : 'disabled';
          return `  ${String(name).padEnd(30)} id=${id}  role=${role}  [${enabled}]`;
        });

        return textResponse(`Пользователи (${users.length}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. iam_list_service_users
  server.tool(
    'iam_list_service_users',
    'Список сервисных пользователей (API-аккаунты)',
    {},
    async () => {
      try {
        const res = await fetchSelectel(`${IAM_API}/service_users`, {
          authType: 'keystone',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const users = data.service_users ?? data.users ?? data.results ?? data ?? [];

        if (!Array.isArray(users) || users.length === 0) {
          return textResponse('Нет сервисных пользователей.');
        }

        const lines = users.map((u: Record<string, unknown>) => {
          const name = u.name ?? 'n/a';
          const id = u.id ?? '';
          const enabled = u.enabled !== false ? 'active' : 'disabled';
          const roles = Array.isArray(u.roles) ? (u.roles as Array<Record<string, unknown>>).map((r) => r.name ?? r.role_name ?? '').join(', ') : '';
          return `  ${String(name).padEnd(30)} id=${id}  [${enabled}]${roles ? `  roles: ${roles}` : ''}`;
        });

        return textResponse(`Сервисные пользователи (${users.length}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 3. iam_list_roles
  server.tool(
    'iam_list_roles',
    'Доступные роли в Selectel IAM',
    {},
    async () => {
      try {
        const res = await fetchSelectel(`${IAM_API}/roles`, {
          authType: 'keystone',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const roles = data.roles ?? data.results ?? data ?? [];

        if (!Array.isArray(roles) || roles.length === 0) {
          return textResponse('Нет доступных ролей.');
        }

        const lines = roles.map((r: Record<string, unknown>) => {
          const name = r.name ?? r.role_name ?? 'n/a';
          const desc = r.description ?? '';
          const scope = r.scope ?? '';
          return `  ${String(name).padEnd(30)} ${scope ? `scope=${scope}  ` : ''}${desc}`;
        });

        return textResponse(`Роли (${roles.length}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 4. iam_list_projects
  server.tool(
    'iam_list_projects',
    'Список проектов Selectel',
    {},
    async () => {
      try {
        const res = await fetchSelectel('https://api.selectel.ru/vpc/resell/v2/projects', {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const projects = data.projects ?? data.results ?? data ?? [];

        if (!Array.isArray(projects) || projects.length === 0) {
          return textResponse('Нет проектов.');
        }

        const lines = projects.map((p: Record<string, unknown>) => {
          const name = p.name ?? 'n/a';
          const id = p.id ?? p.project_id ?? '';
          const enabled = p.enabled !== false ? 'active' : 'disabled';
          const url = p.url ?? '';
          return `  ${String(name).padEnd(30)} id=${id}  [${enabled}]${url ? `  url=${url}` : ''}`;
        });

        return textResponse(`Проекты (${projects.length}):\n${lines.join('\n')}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 5. iam_user_info
  server.tool(
    'iam_user_info',
    'Информация о текущем авторизованном пользователе',
    {},
    async () => {
      try {
        const res = await fetchSelectel('https://api.selectel.ru/iam/v1/users/current', {
          authType: 'keystone',
        });

        if (!res.ok) {
          // Fallback: try the VPC endpoint
          const res2 = await fetchSelectel('https://api.selectel.ru/vpc/resell/v2/users/current', {
            authType: 'xtoken',
          });

          if (!res2.ok) {
            return errorResponse(`Ошибка API (${res.status}/${res2.status}): не удалось получить информацию о пользователе`);
          }

          const data = await res2.json();
          return textResponse(formatUserInfo(data));
        }

        const data = await res.json();
        return textResponse(formatUserInfo(data));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}

function formatUserInfo(data: Record<string, unknown>): string {
  const lines = ['Текущий пользователь:'];
  const fields: Array<[string, string]> = [
    ['ID', String(data.id ?? data.user_id ?? 'n/a')],
    ['Имя', String(data.name ?? data.login ?? 'n/a')],
    ['Email', String(data.email ?? 'n/a')],
    ['Роль', String(data.role ?? data.roles ?? 'n/a')],
    ['Статус', data.enabled !== false ? 'active' : 'disabled'],
  ];

  for (const [label, value] of fields) {
    lines.push(`  ${label}: ${value}`);
  }

  return lines.join('\n');
}
