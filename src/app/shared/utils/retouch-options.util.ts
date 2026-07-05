/**
 * Группировка опций ретуши для read-only показа.
 *
 * Опции ретуши исторически, массив строк; начиная с конфигуратора
 * «Супер обработки», массив объектов {group, group_name, slug, label}.
 * Группируем по group_name; строковый формат, единая группа без
 * заголовка (fallback opt.label ?? opt).
 *
 * Логика идентична `groupedOptions()` из
 * features/employee/components/retouch-queue/retouch-task-card.component.ts
 * (эталон). retouch-task-card на этот util НЕ переключаем (меньше регресса).
 */

export interface RetouchOptionObjectLike {
  group?: string;
  group_name?: string;
  slug?: string;
  label?: string;
}

/** Опция ретуши: исторический строковый формат ИЛИ объект. */
export type RetouchOptionLike = string | RetouchOptionObjectLike;

export interface RetouchOptionItemView {
  key: string;
  label: string;
}

export interface RetouchOptionGroupView {
  key: string;
  name: string;
  items: RetouchOptionItemView[];
}

export function groupRetouchOptions(
  options: readonly RetouchOptionLike[],
): RetouchOptionGroupView[] {
  const groups: RetouchOptionGroupView[] = [];
  const byKey = new Map<string, RetouchOptionGroupView>();
  options.forEach((opt, index) => {
    const isObj = typeof opt === 'object' && opt !== null;
    const groupName = isObj ? (opt.group_name ?? '') : '';
    const groupKey = isObj ? (opt.group ?? opt.group_name ?? '') : '';
    const label = isObj ? (opt.label ?? opt.slug ?? '') : opt;
    const itemKey = isObj ? (opt.slug ?? `i${index}`) : `s${index}`;
    const mapKey = groupName ? `${groupKey}|${groupName}` : '';
    let group = byKey.get(mapKey);
    if (!group) {
      group = { key: mapKey || 'flat', name: groupName, items: [] };
      byKey.set(mapKey, group);
      groups.push(group);
    }
    group.items.push({ key: itemKey, label });
  });
  return groups;
}
