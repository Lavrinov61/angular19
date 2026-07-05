import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchSelectel } from '../auth.js';
import { textResponse, errorResponse } from '../types.js';

const BILLING_API = 'https://api.selectel.ru/v3/billing';

export function registerBillingTools(server: McpServer): void {
  // 1. billing_balance
  server.tool(
    'billing_balance',
    'Текущий баланс аккаунта Selectel',
    {},
    async () => {
      try {
        const res = await fetchSelectel(`${BILLING_API}/balance`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          return errorResponse(`Ошибка API (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        const balance = data.balance ?? data;

        if (typeof balance === 'object') {
          const main = balance.main ?? balance.primary ?? balance.amount ?? 'n/a';
          const bonus = balance.bonus ?? balance.vk_roubles ?? 0;
          const debt = balance.debt ?? 0;
          const currency = balance.currency ?? 'RUB';

          const lines = [
            'Баланс аккаунта Selectel:',
            `  Основной: ${main} ${currency}`,
          ];
          if (bonus) lines.push(`  Бонусный: ${bonus} ${currency}`);
          if (debt) lines.push(`  Задолженность: ${debt} ${currency}`);

          return textResponse(lines.join('\n'));
        }

        return textResponse(`Баланс: ${balance}`);
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );

  // 2. billing_prediction
  server.tool(
    'billing_prediction',
    'Прогноз: на сколько дней хватит текущего баланса',
    {},
    async () => {
      try {
        const res = await fetchSelectel(`${BILLING_API}/prediction`, {
          authType: 'xtoken',
        });

        if (!res.ok) {
          // Try alternative endpoint
          const res2 = await fetchSelectel(`${BILLING_API}/forecast`, {
            authType: 'xtoken',
          });

          if (!res2.ok) {
            return errorResponse(`Ошибка API (${res.status}/${res2.status}): ${await res.text()}`);
          }

          const data = await res2.json();
          return textResponse(formatPrediction(data));
        }

        const data = await res.json();
        return textResponse(formatPrediction(data));
      } catch (e) {
        return errorResponse(`Ошибка: ${(e as Error).message}`);
      }
    },
  );
}

function formatPrediction(data: Record<string, unknown>): string {
  const lines = ['Прогноз баланса:'];

  if (data.prediction_date ?? data.forecast_date ?? data.end_date) {
    lines.push(`  Баланс закончится: ${data.prediction_date ?? data.forecast_date ?? data.end_date}`);
  }

  if (data.days_left !== undefined) {
    lines.push(`  Дней осталось: ${data.days_left}`);
  }

  if (data.daily_cost !== undefined) {
    lines.push(`  Расход в день: ${data.daily_cost} руб.`);
  }

  if (data.monthly_cost !== undefined) {
    lines.push(`  Расход в месяц: ${data.monthly_cost} руб.`);
  }

  if (lines.length === 1) {
    lines.push(`  ${JSON.stringify(data, null, 2)}`);
  }

  return lines.join('\n');
}
