/**
 * order-reminder.service.ts — Pure function that generates automatic reminders
 * for employees based on document template and order context.
 *
 * No side effects, no DB calls — used by walk-in and crm-create endpoints
 * to populate employee_reminder JSONB column.
 */

export interface OrderReminderInput {
  documentTemplateSlug?: string | null;
  documentTemplateCategory?: string | null;
  medalsRequired?: boolean;
  wishes?: string | null;
}

export interface Reminder {
  type: 'warning' | 'info';
  code: string;
  message: string;
}

/**
 * Generate auto-reminders based on order context.
 * Rules:
 *  - zagranpassport → warning about international passport photo requirements
 *  - visa → warning about country-specific visa photo requirements
 *  - military → info about medals/awards placement
 *  - medals_required → info about medals preparation
 */
export function generateAutoReminders(input: OrderReminderInput): Reminder[] {
  const reminders: Reminder[] = [];
  const slug = input.documentTemplateSlug?.toLowerCase() ?? '';
  const category = input.documentTemplateCategory?.toLowerCase() ?? '';

  if (slug.includes('zagranpassport') || category === 'zagranpassport') {
    reminders.push({
      type: 'warning',
      code: 'zagranpassport_requirements',
      message: 'Загранпаспорт: белый фон, строго анфас, без головных уборов. Размер 35x45 мм.',
    });
  }

  if (slug.includes('visa') || category === 'visa') {
    reminders.push({
      type: 'warning',
      code: 'visa_requirements',
      message: 'Виза: проверить требования конкретной страны (размер, фон, поля). Уточнить у клиента страну назначения.',
    });
  }

  if (slug.includes('military') || category === 'military') {
    reminders.push({
      type: 'info',
      code: 'military_medals',
      message: 'Военный билет / удостоверение: уточнить наличие наград и медалей для размещения на фото.',
    });
  }

  if (input.medalsRequired) {
    reminders.push({
      type: 'info',
      code: 'medals_preparation',
      message: 'Клиент указал наличие медалей/наград. Подготовить размещение на фото.',
    });
  }

  if (input.wishes) {
    reminders.push({
      type: 'info',
      code: 'client_wishes',
      message: `Пожелания клиента: ${input.wishes}`,
    });
  }

  return reminders;
}
