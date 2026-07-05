/**
 * retouch-checklist.service.ts — каталог «Супер обработки» и серверная валидация выбора.
 *
 * Источник данных: таблица super_retouch_checklist_items (DB-driven, редактируемая без деплоя).
 * - getRetouchChecklist() — публичный каталог для конфигуратора в кассе.
 * - resolveRetouchConfig() — анти-tamper валидация выбора оператора по каталогу
 *   (отбрасывает неизвестные/неактивные slug, режет single-группы, фильтрует по полу).
 */

import db from '../database/db.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RetouchSelectionType = 'single' | 'multi' | 'notes';
export type RetouchGender = 'male' | 'female' | 'any';

export interface RetouchChecklistItem {
  slug: string;
  name: string;
  hint: string | null;
  gender: RetouchGender;
  icon: string | null;
  is_default: boolean;
  addon_price: number;
}

export interface RetouchChecklistGroup {
  group_slug: string;
  group_name: string;
  selection_type: RetouchSelectionType;
  sort_order: number;
  items: RetouchChecklistItem[];
}

interface ChecklistRow {
  group_slug: string;
  group_name: string;
  group_selection_type: RetouchSelectionType;
  group_sort_order: number;
  slug: string;
  name: string;
  hint: string | null;
  gender: RetouchGender;
  icon: string | null;
  is_default: boolean;
  addon_price: string | number;
}

export interface ResolveRetouchConfigInput {
  gender?: RetouchGender;
  groups: Record<string, string[]>;
  notes?: string;
}

export interface ResolvedRetouchOption {
  group: string;
  group_name: string;
  slug: string;
  label: string;
}

export interface ResolvedRetouchConfig {
  options: ResolvedRetouchOption[];
  notes: string | null;
  gender: RetouchGender;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

/**
 * Загрузить активный каталог, сгруппированный по group_slug.
 * Без кэша — таблица маленькая (~110 строк), нет риска рассинхрона при правке каталога.
 */
export async function getRetouchChecklist(): Promise<RetouchChecklistGroup[]> {
  const rows = await db.query<ChecklistRow>(
    `SELECT group_slug, group_name, group_selection_type, group_sort_order,
            slug, name, hint, gender, icon, is_default, addon_price
       FROM super_retouch_checklist_items
      WHERE is_active = true
      ORDER BY group_sort_order, sort_order`,
  );

  const groups: RetouchChecklistGroup[] = [];
  const byGroup = new Map<string, RetouchChecklistGroup>();

  for (const row of rows) {
    let group = byGroup.get(row.group_slug);
    if (!group) {
      group = {
        group_slug: row.group_slug,
        group_name: row.group_name,
        selection_type: row.group_selection_type,
        sort_order: row.group_sort_order,
        items: [],
      };
      byGroup.set(row.group_slug, group);
      groups.push(group);
    }
    group.items.push({
      slug: row.slug,
      name: row.name,
      hint: row.hint,
      gender: row.gender,
      icon: row.icon,
      is_default: row.is_default,
      addon_price: Number(row.addon_price),
    });
  }

  return groups;
}

// ─── Server-side validation (anti-tamper) ───────────────────────────────────

interface CatalogEntry {
  group_slug: string;
  group_name: string;
  name: string;
  gender: RetouchGender;
  group_selection_type: RetouchSelectionType;
}

/**
 * Серверная валидация выбора оператора по каталогу.
 * Не доверяем клиенту: разрешены только активные slug из каталога.
 * - Отбрасывает неизвестные/неактивные slug.
 * - Для single-групп оставляет ≤1 выбранного.
 * - Отбрасывает slug, чей gender ≠ переданному input.gender (кроме gender='any') [P1-5].
 */
export async function resolveRetouchConfig(
  input: ResolveRetouchConfigInput,
): Promise<ResolvedRetouchConfig> {
  const catalog = await getRetouchChecklist();

  const bySlug = new Map<string, CatalogEntry>();
  for (const group of catalog) {
    for (const item of group.items) {
      bySlug.set(item.slug, {
        group_slug: group.group_slug,
        group_name: group.group_name,
        name: item.name,
        gender: item.gender,
        group_selection_type: group.selection_type,
      });
    }
  }

  const requestedGender: RetouchGender = input.gender ?? 'any';
  const options: ResolvedRetouchOption[] = [];
  const singleGroupsUsed = new Set<string>();

  const groups = input.groups ?? {};
  for (const groupSlug of Object.keys(groups)) {
    const slugs = groups[groupSlug];
    if (!Array.isArray(slugs)) continue;

    for (const slug of slugs) {
      const entry = bySlug.get(slug);
      // Неизвестный/неактивный slug — отбрасываем.
      if (!entry) continue;
      // Игнорируем slug, заявленный не в своей группе (анти-tamper).
      if (entry.group_slug !== groupSlug) continue;
      // Пол-консистентность: отбрасываем slug чужого пола (кроме 'any') [P1-5].
      if (requestedGender !== 'any' && entry.gender !== 'any' && entry.gender !== requestedGender) {
        continue;
      }
      // single-группа: оставляем только первый выбор.
      if (entry.group_selection_type === 'single') {
        if (singleGroupsUsed.has(entry.group_slug)) continue;
        singleGroupsUsed.add(entry.group_slug);
      }

      options.push({
        group: entry.group_slug,
        group_name: entry.group_name,
        slug,
        label: entry.name,
      });
    }
  }

  const notes = typeof input.notes === 'string' && input.notes.trim().length > 0
    ? input.notes.trim()
    : null;

  return { options, notes, gender: requestedGender };
}
