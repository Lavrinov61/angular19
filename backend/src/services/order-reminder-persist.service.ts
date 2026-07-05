/**
 * order-reminder-persist.service.ts — Looks up template, generates reminders,
 * and persists them to photo_print_orders.employee_reminder.
 */
import db from '../database/db.js';
import { generateAutoReminders } from './order-reminder.service.js';

export async function persistAutoReminders(
  orderId: string,
  templateId: string | null | undefined,
  medalsRequired: boolean | undefined,
  wishes: string | undefined,
): Promise<void> {
  let templateSlug: string | null = null;
  let templateCategory: string | null = null;
  if (templateId) {
    const tpl = await db.queryOne<{ slug: string; category: string }>(
      `SELECT slug, category FROM document_templates WHERE id = $1`,
      [templateId],
    );
    if (tpl) {
      templateSlug = tpl.slug;
      templateCategory = tpl.category;
    }
  }
  const reminders = generateAutoReminders({
    documentTemplateSlug: templateSlug,
    documentTemplateCategory: templateCategory,
    medalsRequired: medalsRequired,
    wishes,
  });
  if (reminders.length > 0) {
    await db.query(
      `UPDATE photo_print_orders SET employee_reminder = $1 WHERE order_id = $2`,
      [JSON.stringify(reminders), orderId],
    );
  }
}
