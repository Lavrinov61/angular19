import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRetouchChecklist, resolveRetouchConfig } from './retouch-checklist.service.js';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: dbMock,
}));

interface RowOverrides {
  group_slug?: string;
  group_name?: string;
  group_selection_type?: 'single' | 'multi' | 'notes';
  group_sort_order?: number;
  slug: string;
  name?: string;
  hint?: string | null;
  gender?: 'male' | 'female' | 'any';
  icon?: string | null;
  is_default?: boolean;
  addon_price?: string | number;
}

function row(o: RowOverrides) {
  return {
    group_slug: o.group_slug ?? 'makeup-style',
    group_name: o.group_name ?? 'Стиль макияжа',
    group_selection_type: o.group_selection_type ?? 'multi',
    group_sort_order: o.group_sort_order ?? 0,
    slug: o.slug,
    name: o.name ?? o.slug,
    hint: o.hint ?? null,
    gender: o.gender ?? 'any',
    icon: o.icon ?? null,
    is_default: o.is_default ?? false,
    addon_price: o.addon_price ?? '0.00',
  };
}

// Каталог-фикстура: multi-группа makeup-accent, single-группа skin-tone, gender-варианты.
const catalogRows = [
  row({ group_slug: 'makeup-accent', group_name: 'Акценты макияжа', group_selection_type: 'multi', group_sort_order: 1, slug: 'accent-eyes' }),
  row({ group_slug: 'makeup-accent', group_name: 'Акценты макияжа', group_selection_type: 'multi', group_sort_order: 1, slug: 'accent-lips' }),
  row({ group_slug: 'skin-tone', group_name: 'Тон кожи', group_selection_type: 'single', group_sort_order: 2, slug: 'tone-warm' }),
  row({ group_slug: 'skin-tone', group_name: 'Тон кожи', group_selection_type: 'single', group_sort_order: 2, slug: 'tone-cool' }),
  row({ group_slug: 'womens-clothing', group_name: 'Женская одежда', group_selection_type: 'single', group_sort_order: 3, slug: 'dress-business', gender: 'female' }),
  row({ group_slug: 'mens-clothing', group_name: 'Мужская одежда', group_selection_type: 'single', group_sort_order: 4, slug: 'suit-classic', gender: 'male' }),
];

describe('getRetouchChecklist', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it('groups flat rows by group_slug, preserving order and numeric addon_price', async () => {
    dbMock.query.mockResolvedValue(catalogRows);
    const groups = await getRetouchChecklist();

    expect(groups.map(g => g.group_slug)).toEqual([
      'makeup-accent', 'skin-tone', 'womens-clothing', 'mens-clothing',
    ]);
    const accent = groups.find(g => g.group_slug === 'makeup-accent')!;
    expect(accent.selection_type).toBe('multi');
    expect(accent.items.map(i => i.slug)).toEqual(['accent-eyes', 'accent-lips']);
    expect(accent.items[0].addon_price).toBe(0);
    expect(typeof accent.items[0].addon_price).toBe('number');
  });
});

describe('resolveRetouchConfig', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.query.mockResolvedValue(catalogRows);
  });

  it('drops unknown / inactive slugs', async () => {
    const result = await resolveRetouchConfig({
      groups: { 'makeup-accent': ['accent-eyes', 'totally-unknown-slug'] },
    });
    expect(result.options.map(o => o.slug)).toEqual(['accent-eyes']);
    expect(result.options[0]).toMatchObject({
      group: 'makeup-accent',
      group_name: 'Акценты макияжа',
      slug: 'accent-eyes',
      label: 'accent-eyes',
    });
  });

  it('keeps at most one option for single-selection groups', async () => {
    const result = await resolveRetouchConfig({
      groups: { 'skin-tone': ['tone-warm', 'tone-cool'] },
    });
    const toneOptions = result.options.filter(o => o.group === 'skin-tone');
    expect(toneOptions).toHaveLength(1);
    expect(toneOptions[0].slug).toBe('tone-warm');
  });

  it('drops slugs whose gender does not match requested gender (except any)', async () => {
    const result = await resolveRetouchConfig({
      gender: 'male',
      groups: {
        'mens-clothing': ['suit-classic'],
        'womens-clothing': ['dress-business'],
        'makeup-accent': ['accent-eyes'],
      },
    });
    const slugs = result.options.map(o => o.slug);
    // мужская одежда и нейтральный акцент остаются, женская одежда отброшена
    expect(slugs).toContain('suit-classic');
    expect(slugs).toContain('accent-eyes');
    expect(slugs).not.toContain('dress-business');
    expect(result.gender).toBe('male');
  });

  it('rejects slug claimed under wrong group (anti-tamper)', async () => {
    const result = await resolveRetouchConfig({
      groups: { 'makeup-accent': ['tone-warm'] }, // tone-warm принадлежит skin-tone
    });
    expect(result.options).toHaveLength(0);
  });

  it('trims notes and defaults gender to any', async () => {
    const result = await resolveRetouchConfig({
      groups: {},
      notes: '  убрать блики  ',
    });
    expect(result.notes).toBe('убрать блики');
    expect(result.gender).toBe('any');
    expect(result.options).toEqual([]);
  });

  it('returns null notes for empty/blank string', async () => {
    const result = await resolveRetouchConfig({ groups: {}, notes: '   ' });
    expect(result.notes).toBeNull();
  });
});
