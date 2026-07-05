import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getKeystoneToken } from '../auth.js';
import { SELECTEL_CONFIRM, requireConfirm } from '../confirm.js';
import { textResponse, errorResponse } from '../types.js';
import { z } from 'zod';

const BASE = 'https://api.selectel.ru/mobiledevicefarm';

async function farmFetch(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const token = await getKeystoneToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-Auth-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export function registerMobileFarmTools(server: McpServer) {

  // === Devices ===

  server.tool(
    'farm_list_devices',
    'Список доступных мобильных устройств для тестирования',
    {},
    async () => {
      const data = await farmFetch('/api/v2/devices') as any;
      if (!data.devices?.length) return textResponse('Нет доступных устройств');
      const lines = data.devices.map((d: any) =>
        `${d.marketName || d.model} (${d.manufacturer}) — ${d.platform} ${d.version}, SDK ${d.sdk}, serial: ${d.serial}`
      );
      return textResponse(`Доступных устройств: ${data.devices.length}\n\n${lines.join('\n')}`);
    }
  );

  server.tool(
    'farm_device_info',
    'Информация о конкретном мобильном устройстве',
    { serial: z.string().describe('Серийный номер устройства') },
    async ({ serial }) => {
      const data = await farmFetch(`/api/v1/devices/${serial}`) as any;
      if (!data.success) return errorResponse(data.description || 'Устройство не найдено');
      const d = data.device;
      return textResponse([
        `${d.marketName || d.model} (${d.manufacturer})`,
        `Platform: ${d.platform} ${d.version} (SDK ${d.sdk})`,
        `CPU: ${d.cpuPlatform}, ABI: ${d.abi}`,
        `Display: ${d.display?.width}x${d.display?.height} (${d.display?.density} dpi)`,
        `Battery: ${d.battery?.level}% (${d.battery?.status})`,
        `Status: ${d.present ? 'online' : 'offline'}, ${d.using ? 'in use' : 'available'}`,
        `Serial: ${d.serial}`,
        d.remoteConnectUrl ? `Remote: ${d.remoteConnectUrl}` : '',
      ].filter(Boolean).join('\n'));
    }
  );

  // === Groups (farms) ===

  server.tool(
    'farm_list_groups',
    'Список групп (ферм) мобильных устройств',
    {},
    async () => {
      const data = await farmFetch('/api/v2/groups') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка');
      if (!data.groups?.length) return textResponse('Нет групп устройств');
      const lines = data.groups.map((g: any) =>
        `[${g.id}] ${g.name} — ${g.devices?.length || 0} устройств`
      );
      return textResponse(lines.join('\n'));
    }
  );

  server.tool(
    'farm_create_group',
    `Создать группу (ферму) мобильных устройств. Requires confirm="${SELECTEL_CONFIRM.FARM_CREATE_GROUP}".`,
    {
      name: z.string().describe('Имя группы'),
      billing_type: z.enum(['minutes', 'hours']).describe('Тип тарификации'),
      confirm: z.string().optional().default('').describe('Подтверждение создания группы'),
    },
    async ({ name, billing_type, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_CREATE_GROUP, 'create a device farm group');
      if (confirmError) return confirmError;

      const data = await farmFetch('/api/v2/groups', 'POST', {
        name,
        billingType: billing_type,
        devices: [],
      }) as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка создания');
      return textResponse(`Группа создана: ${data.group.name} (ID: ${data.group.id})`);
    }
  );

  server.tool(
    'farm_group_info',
    'Информация о группе мобильных устройств',
    { group_id: z.string().describe('ID группы') },
    async ({ group_id }) => {
      const data = await farmFetch(`/api/v2/groups/${group_id}`) as any;
      if (!data.success) return errorResponse(data.description || 'Группа не найдена');
      const g = data.group;
      const devices = (g.devices || []).map((d: any) =>
        `  ${d.marketName || d.model} (${d.manufacturer}) — ${d.serial}`
      ).join('\n');
      return textResponse(`${g.name} (${g.id})\nУстройств: ${g.devices?.length || 0}\n${devices}`);
    }
  );

  server.tool(
    'farm_delete_group',
    `Удалить группу мобильных устройств. Requires confirm="${SELECTEL_CONFIRM.FARM_DELETE_GROUP}".`,
    {
      group_id: z.string().describe('ID группы'),
      confirm: z.string().optional().default('').describe('Подтверждение удаления группы'),
    },
    async ({ group_id, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_DELETE_GROUP, 'delete a device farm group');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v2/groups/${group_id}`, 'DELETE') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка удаления');
      return textResponse(`Группа ${group_id} удалена`);
    }
  );

  server.tool(
    'farm_add_device_to_group',
    `Добавить устройство в группу. Requires confirm="${SELECTEL_CONFIRM.FARM_ADD_DEVICE_TO_GROUP}".`,
    {
      group_id: z.string().describe('ID группы'),
      manufacturer: z.string().describe('Производитель (Samsung, Google, etc)'),
      market_name: z.string().describe('Название устройства (Pixel 7, Galaxy S23, etc)'),
      version: z.string().describe('Версия Android/iOS'),
      sdk: z.string().describe('SDK версия'),
      count: z.number().default(1).describe('Количество устройств'),
      confirm: z.string().optional().default('').describe('Подтверждение добавления устройства'),
    },
    async ({ group_id, manufacturer, market_name, version, sdk, count, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_ADD_DEVICE_TO_GROUP, 'add a device to a farm group');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v2/groups/${group_id}/devices`, 'PUT', {
        devices: [{ manufacturer, marketName: market_name, version, sdk, count }],
      }) as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка добавления');
      return textResponse(`Добавлено в группу ${group_id}. Устройств в группе: ${data.group.devices?.length || 0}`);
    }
  );

  server.tool(
    'farm_remove_device',
    `Убрать устройство из группы. Requires confirm="${SELECTEL_CONFIRM.FARM_REMOVE_DEVICE}".`,
    {
      group_id: z.string().describe('ID группы'),
      serial: z.string().describe('Серийный номер устройства'),
      confirm: z.string().optional().default('').describe('Подтверждение удаления устройства из группы'),
    },
    async ({ group_id, serial, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_REMOVE_DEVICE, 'remove a device from a farm group');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v2/groups/${group_id}/devices/${serial}`, 'DELETE') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка удаления');
      return textResponse(`Устройство ${serial} убрано из группы`);
    }
  );

  // === User devices ===

  server.tool(
    'farm_assign_device',
    `Назначить устройство пользователю (Android only). Requires confirm="${SELECTEL_CONFIRM.FARM_ASSIGN_DEVICE}".`,
    {
      serial: z.string().describe('Серийный номер устройства'),
      timeout_hours: z.number().default(9).describe('Таймаут в часах (default 9)'),
      confirm: z.string().optional().default('').describe('Подтверждение назначения устройства'),
    },
    async ({ serial, timeout_hours, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_ASSIGN_DEVICE, 'assign a device');
      if (confirmError) return confirmError;

      const data = await farmFetch('/api/v1/user/devices', 'POST', {
        serial,
        timeout: timeout_hours * 3600000,
      }) as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка назначения');
      return textResponse(`Устройство ${serial} назначено. Таймаут: ${timeout_hours}ч`);
    }
  );

  server.tool(
    'farm_release_device',
    `Освободить устройство (Android only). Requires confirm="${SELECTEL_CONFIRM.FARM_RELEASE_DEVICE}".`,
    {
      serial: z.string().describe('Серийный номер устройства'),
      confirm: z.string().optional().default('').describe('Подтверждение освобождения устройства'),
    },
    async ({ serial, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_RELEASE_DEVICE, 'release a device');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v1/user/devices/${serial}`, 'DELETE') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка');
      return textResponse(`Устройство ${serial} освобождено`);
    }
  );

  server.tool(
    'farm_adb_connect',
    `Начать ADB remote connect сессию (Android only). Requires confirm="${SELECTEL_CONFIRM.FARM_ADB_CONNECT}".`,
    {
      serial: z.string().describe('Серийный номер устройства'),
      confirm: z.string().optional().default('').describe('Подтверждение ADB подключения'),
    },
    async ({ serial, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_ADB_CONNECT, 'start an ADB remote connect session');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v1/user/devices/${serial}/remoteConnect`, 'POST') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка подключения');
      return textResponse(`ADB подключение: ${data.remoteConnectUrl}\n\nИспользуй: adb connect ${data.remoteConnectUrl}`);
    }
  );

  server.tool(
    'farm_adb_disconnect',
    `Завершить ADB remote connect сессию. Requires confirm="${SELECTEL_CONFIRM.FARM_ADB_DISCONNECT}".`,
    {
      serial: z.string().describe('Серийный номер устройства'),
      confirm: z.string().optional().default('').describe('Подтверждение завершения ADB сессии'),
    },
    async ({ serial, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_ADB_DISCONNECT, 'end an ADB remote connect session');
      if (confirmError) return confirmError;

      const data = await farmFetch(`/api/v1/user/devices/${serial}/remoteConnect`, 'DELETE') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка');
      return textResponse(`ADB сессия для ${serial} завершена`);
    }
  );

  // === ADB Keys ===

  server.tool(
    'farm_list_adb_keys',
    'Список ADB ключей',
    {},
    async () => {
      const data = await farmFetch('/api/v2/keys/adb') as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка');
      if (!data.adbKeys?.length) return textResponse('Нет ADB ключей');
      const lines = data.adbKeys.map((k: any) => `${k.title || 'без имени'} — ${k.fingerprint}`);
      return textResponse(lines.join('\n'));
    }
  );

  server.tool(
    'farm_add_adb_key',
    `Добавить ADB public key. Requires confirm="${SELECTEL_CONFIRM.FARM_ADD_ADB_KEY}".`,
    {
      public_key: z.string().describe('Публичный RSA ключ для ADB'),
      title: z.string().optional().describe('Название ключа'),
      confirm: z.string().optional().default('').describe('Подтверждение добавления ADB ключа'),
    },
    async ({ public_key, title, confirm }) => {
      const confirmError = requireConfirm(confirm, SELECTEL_CONFIRM.FARM_ADD_ADB_KEY, 'add an ADB key');
      if (confirmError) return confirmError;

      const data = await farmFetch('/api/v2/keys/adb', 'POST', {
        publicKey: public_key,
        ...(title ? { title } : {}),
      }) as any;
      if (!data.success) return errorResponse(data.description || 'Ошибка');
      return textResponse(`ADB ключ добавлен: ${data.adbKey.fingerprint}`);
    }
  );
}
