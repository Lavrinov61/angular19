/**
 * Shared constants and utilities for the Production module.
 * Single source of truth — used by all production components.
 */

import type { ProductionOrderStatus, CategoryAttributeConfig } from '../../services/production-api.service';

// ─── Order Status ─────────────────────────────────────────────────────────────

export const PRODUCTION_STATUS_CONFIG: Record<ProductionOrderStatus, { label: string; color: string }> = {
  draft:         { label: 'Черновик',     color: '#9ca3af' },
  pending:       { label: 'Ожидает',      color: '#60a5fa' },
  sent:          { label: 'Отправлен',    color: '#2dd4bf' },
  confirmed:     { label: 'Подтверждён', color: '#818cf8' },
  in_production: { label: 'В работе',     color: '#fbbf24' },
  quality_check: { label: 'Контроль',     color: '#c084fc' },
  shipped:       { label: 'Отгружен',     color: '#3b82f6' },
  delivered:     { label: 'Доставлен',    color: '#34d399' },
  completed:     { label: 'Выполнен',     color: '#22c55e' },
  cancelled:     { label: 'Отменён',      color: '#f87171' },
  returned:      { label: 'Возврат',      color: '#fb923c' },
};

/** Valid forward transitions for each status. */
export const STATUS_TRANSITIONS: Partial<Record<ProductionOrderStatus, ProductionOrderStatus[]>> = {
  draft:         ['pending', 'cancelled'],
  pending:       ['sent', 'cancelled'],
  sent:          ['confirmed', 'cancelled'],
  confirmed:     ['in_production', 'cancelled'],
  in_production: ['quality_check'],
  quality_check: ['shipped', 'in_production'],
  shipped:       ['delivered'],
  delivered:     ['completed', 'returned'],
};

export function getNextStatuses(current: ProductionOrderStatus): ProductionOrderStatus[] {
  return STATUS_TRANSITIONS[current] ?? [];
}

// ─── Printing House Status ────────────────────────────────────────────────────

export const HOUSE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:   { label: 'Активна',       color: '#22c55e' },
  inactive: { label: 'Неактивна',     color: '#9ca3af' },
  testing:  { label: 'Тестирование',  color: '#fbbf24' },
};

// ─── Capabilities ─────────────────────────────────────────────────────────────

export const CAPABILITY_LIST: { value: string; label: string }[] = [
  { value: 'photo_print',      label: 'Фотопечать' },
  { value: 'canvas',           label: 'Холсты' },
  { value: 'photo_book',       label: 'Фотокниги' },
  { value: 'calendar',         label: 'Календари' },
  { value: 'souvenir',         label: 'Сувениры' },
  { value: 'polygraphy',       label: 'Полиграфия' },
  { value: 'large_format',     label: 'Широкий формат' },
  { value: 'graduation_album', label: 'Выпускные альбомы' },
];

export const CAPABILITY_LABELS: Record<string, string> = Object.fromEntries(
  CAPABILITY_LIST.map(c => [c.value, c.label]),
);

// ─── Product Category Labels ──────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<string, string> = {
  photo_print:      'Фотопечать',
  canvas:           'Холсты',
  photo_book:       'Фотокниги',
  calendar:         'Календари',
  poster:           'Постеры',
  polygraphy:       'Полиграфия',
  souvenir:         'Сувениры',
  graduation_album: 'Выпускные альбомы',
  large_format:     'Широкоформатная',
};

export function catLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

// ─── Pricing Unit Labels ──────────────────────────────────────────────────────

export const UNIT_LABELS: Record<string, string> = {
  piece: 'шт.',
  page: 'стр.',
  set: 'компл.',
  meter: 'м',
  sqmeter: 'м²',
};

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

// ─── Delivery Method Labels ───────────────────────────────────────────────────

export const DELIVERY_LABELS: Record<string, string> = {
  pickup:  'Самовывоз',
  courier: 'Курьер',
  post:    'Почта',
};

export function deliveryLabel(method: string): string {
  return DELIVERY_LABELS[method] ?? method;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatProductionCost(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'М₽';
  if (v >= 1000) return Math.round(v / 1000) + 'к₽';
  return Math.round(v) + '₽';
}

export function isOrderOverdue(order: { deadline_at: string | null; status: string }): boolean {
  if (!order.deadline_at) return false;
  const TERMINAL = new Set(['completed', 'cancelled', 'returned']);
  return new Date(order.deadline_at) < new Date() && !TERMINAL.has(order.status);
}

// ─── Product Specification Schema ─────────────────────────────────────────────

/** Маппинг категории продукта на список применимых атрибутов спецификации */
export const CATEGORY_ATTRIBUTE_SCHEMA: Record<string, CategoryAttributeConfig[]> = {
  photo_book: [
    { key: 'sizes',          type: 'multiselect', refType: 'size',           label: 'Размеры',             required: true },
    { key: 'page_count',     type: 'range',        refType: null,             label: 'Кол-во разворотов',   required: false },
    { key: 'bindings',       type: 'multiselect', refType: 'binding',        label: 'Переплёт',             required: true },
    { key: 'covers',         type: 'multiselect', refType: 'cover',          label: 'Обложка',              required: false },
    { key: 'papers',         type: 'multiselect', refType: 'paper_type',     label: 'Тип бумаги',          required: false },
    { key: 'paper_weights',  type: 'multiselect', refType: 'paper_weight',   label: 'Плотность бумаги',    required: false },
    { key: 'lamination',     type: 'multiselect', refType: 'lamination',     label: 'Ламинация',            required: false },
    { key: 'page_thickness', type: 'multiselect', refType: 'page_thickness', label: 'Толщина страниц',      required: false },
    { key: 'decor',          type: 'multiselect', refType: 'decor',          label: 'Декор / доп. опции',  required: false },
    { key: 'six_color',      type: 'boolean',     refType: null,             label: '6-цветная печать',    required: false },
  ],
  canvas: [
    { key: 'sizes',          type: 'multiselect', refType: 'size',      label: 'Размеры',          required: true },
    { key: 'stretcher',      type: 'multiselect', refType: 'stretcher', label: 'Подрамник',        required: false },
    { key: 'gallery_wrap',   type: 'boolean',     refType: null,        label: 'Галерейная натяжка', required: false },
    { key: 'lamination',     type: 'multiselect', refType: 'lamination',label: 'Лак / ламинация',  required: false },
  ],
  photo_print: [
    { key: 'sizes',      type: 'multiselect', refType: 'size',       label: 'Размеры',    required: true },
    { key: 'papers',     type: 'multiselect', refType: 'paper_type', label: 'Тип бумаги', required: false },
    { key: 'lamination', type: 'multiselect', refType: 'lamination', label: 'Ламинация',  required: false },
  ],
  calendar: [
    { key: 'sizes',      type: 'multiselect', refType: 'size',       label: 'Размеры',          required: true },
    { key: 'page_count', type: 'range',       refType: null,         label: 'Кол-во листов',    required: false },
    { key: 'bindings',   type: 'multiselect', refType: 'binding',    label: 'Крепление',        required: false },
    { key: 'papers',     type: 'multiselect', refType: 'paper_type', label: 'Тип бумаги',       required: false },
  ],
  graduation_album: [
    { key: 'sizes',          type: 'multiselect', refType: 'size',           label: 'Размеры',          required: true },
    { key: 'page_count',     type: 'range',       refType: null,             label: 'Кол-во страниц',   required: false },
    { key: 'bindings',       type: 'multiselect', refType: 'binding',        label: 'Переплёт',         required: true },
    { key: 'covers',         type: 'multiselect', refType: 'cover',          label: 'Обложка',          required: false },
    { key: 'papers',         type: 'multiselect', refType: 'paper_type',     label: 'Тип бумаги',       required: false },
    { key: 'paper_weights',  type: 'multiselect', refType: 'paper_weight',   label: 'Плотность бумаги', required: false },
    { key: 'lamination',     type: 'multiselect', refType: 'lamination',     label: 'Ламинация',        required: false },
    { key: 'decor',          type: 'multiselect', refType: 'decor',          label: 'Декор',            required: false },
    { key: 'six_color',      type: 'boolean',     refType: null,             label: '6-цветная печать', required: false },
  ],
  souvenir: [
    { key: 'materials', type: 'multiselect', refType: 'material', label: 'Материал',     required: true },
    { key: 'sizes',     type: 'multiselect', refType: 'size',     label: 'Размер/объём', required: false },
  ],
  large_format: [
    { key: 'sizes',      type: 'multiselect', refType: 'size',         label: 'Размеры',    required: true },
    { key: 'papers',     type: 'multiselect', refType: 'paper_type',   label: 'Материал',   required: false },
    { key: 'lamination', type: 'multiselect', refType: 'lamination',   label: 'Ламинация',  required: false },
  ],
  polygraphy: [
    { key: 'sizes',         type: 'multiselect', refType: 'size',         label: 'Форматы',          required: true },
    { key: 'papers',        type: 'multiselect', refType: 'paper_type',   label: 'Тип бумаги',       required: false },
    { key: 'paper_weights', type: 'multiselect', refType: 'paper_weight', label: 'Плотность бумаги', required: false },
    { key: 'lamination',    type: 'multiselect', refType: 'lamination',   label: 'Ламинация',        required: false },
    { key: 'bindings',      type: 'multiselect', refType: 'binding',      label: 'Переплёт',         required: false },
  ],
  poster: [
    { key: 'sizes',      type: 'multiselect', refType: 'size',       label: 'Размеры',    required: true },
    { key: 'papers',     type: 'multiselect', refType: 'paper_type', label: 'Тип бумаги', required: false },
    { key: 'lamination', type: 'multiselect', refType: 'lamination', label: 'Ламинация',  required: false },
  ],
};

/** Метки для ref_type (для заголовков групп в UI справочника) */
export const REF_TYPE_LABELS: Record<string, string> = {
  paper_weight:   'Плотность бумаги',
  paper_type:     'Тип бумаги',
  size:           'Размеры',
  binding:        'Переплёт',
  cover:          'Обложка',
  lamination:     'Ламинация',
  page_thickness: 'Толщина страниц',
  stretcher:      'Подрамник',
  decor:          'Декор / доп. опции',
  material:       'Материал сувениров',
};

/** Вернуть все уникальные ref_type в порядке REF_TYPE_LABELS */
export const REF_TYPE_ORDER = Object.keys(REF_TYPE_LABELS);
