import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_STATUS_CONFIG,
  STATUS_TRANSITIONS,
  getNextStatuses,
  catLabel,
  unitLabel,
  deliveryLabel,
  formatProductionCost,
  isOrderOverdue,
} from './production.constants';
import type { ProductionOrderStatus } from '../../services/production-api.service';

// ─── PRODUCTION_STATUS_CONFIG integrity ───────────────────────────────────────

describe('PRODUCTION_STATUS_CONFIG integrity', () => {
  const allStatuses: ProductionOrderStatus[] = [
    'draft', 'pending', 'sent', 'confirmed', 'in_production',
    'quality_check', 'shipped', 'delivered', 'completed', 'cancelled', 'returned',
  ];

  it('has a label and color for every production status', () => {
    for (const status of allStatuses) {
      expect(PRODUCTION_STATUS_CONFIG[status]).toBeDefined();
      expect(PRODUCTION_STATUS_CONFIG[status].label.length).toBeGreaterThan(0);
      expect(PRODUCTION_STATUS_CONFIG[status].color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

// ─── getNextStatuses ──────────────────────────────────────────────────────────

describe('getNextStatuses', () => {
  it('returns correct forward transitions for each status', () => {
    expect(getNextStatuses('draft')).toEqual(['pending', 'cancelled']);
    expect(getNextStatuses('pending')).toEqual(['sent', 'cancelled']);
    expect(getNextStatuses('sent')).toEqual(['confirmed', 'cancelled']);
    expect(getNextStatuses('confirmed')).toEqual(['in_production', 'cancelled']);
    expect(getNextStatuses('in_production')).toEqual(['quality_check']);
    expect(getNextStatuses('quality_check')).toEqual(['shipped', 'in_production']);
    expect(getNextStatuses('shipped')).toEqual(['delivered']);
    expect(getNextStatuses('delivered')).toEqual(['completed', 'returned']);
  });

  it('returns empty array for terminal statuses with no outgoing transitions', () => {
    expect(getNextStatuses('completed')).toEqual([]);
    expect(getNextStatuses('cancelled')).toEqual([]);
    expect(getNextStatuses('returned')).toEqual([]);
  });

  it('returns empty array for an unknown/invalid status', () => {
    expect(getNextStatuses('nonexistent' as ProductionOrderStatus)).toEqual([]);
  });

  it('transitions do not allow going backwards directly (draft is not reachable from pending)', () => {
    const fromPending = getNextStatuses('pending');
    expect(fromPending).not.toContain('draft');
  });
});

// ─── STATUS_TRANSITIONS graph consistency ─────────────────────────────────────

describe('STATUS_TRANSITIONS graph', () => {
  it('every transition target is a valid production status', () => {
    const validStatuses = new Set(Object.keys(PRODUCTION_STATUS_CONFIG));
    for (const [_from, targets] of Object.entries(STATUS_TRANSITIONS)) {
      for (const target of targets ?? []) {
        expect(validStatuses.has(target), `"${target}" is not a valid status`).toBe(true);
      }
    }
  });
});

// ─── catLabel ─────────────────────────────────────────────────────────────────

describe('catLabel', () => {
  it('returns localised label for known categories', () => {
    expect(catLabel('photo_print')).toBe('Фотопечать');
    expect(catLabel('canvas')).toBe('Холсты');
    expect(catLabel('photo_book')).toBe('Фотокниги');
    expect(catLabel('calendar')).toBe('Календари');
    expect(catLabel('poster')).toBe('Постеры');
    expect(catLabel('polygraphy')).toBe('Полиграфия');
    expect(catLabel('souvenir')).toBe('Сувениры');
    expect(catLabel('graduation_album')).toBe('Выпускные альбомы');
    expect(catLabel('large_format')).toBe('Широкоформатная');
  });

  it('returns raw category key as fallback for unknown category', () => {
    expect(catLabel('unknown_cat')).toBe('unknown_cat');
    expect(catLabel('')).toBe('');
  });
});

// ─── unitLabel ────────────────────────────────────────────────────────────────

describe('unitLabel', () => {
  it('returns localised unit abbreviation for known units', () => {
    expect(unitLabel('piece')).toBe('шт.');
    expect(unitLabel('page')).toBe('стр.');
    expect(unitLabel('set')).toBe('компл.');
    expect(unitLabel('meter')).toBe('м');
    expect(unitLabel('sqmeter')).toBe('м²');
  });

  it('returns raw unit key as fallback for unknown unit', () => {
    expect(unitLabel('gram')).toBe('gram');
    expect(unitLabel('')).toBe('');
  });
});

// ─── deliveryLabel ────────────────────────────────────────────────────────────

describe('deliveryLabel', () => {
  it('returns localised label for known delivery methods', () => {
    expect(deliveryLabel('pickup')).toBe('Самовывоз');
    expect(deliveryLabel('courier')).toBe('Курьер');
    expect(deliveryLabel('post')).toBe('Почта');
  });

  it('returns raw method key as fallback for unknown method', () => {
    expect(deliveryLabel('drone')).toBe('drone');
    expect(deliveryLabel('')).toBe('');
  });
});

// ─── formatProductionCost ─────────────────────────────────────────────────────

describe('formatProductionCost', () => {
  it('formats amounts below 1000 as integer roubles', () => {
    expect(formatProductionCost(0)).toBe('0₽');
    expect(formatProductionCost(1)).toBe('1₽');
    expect(formatProductionCost(999)).toBe('999₽');
    expect(formatProductionCost(500.7)).toBe('501₽');
  });

  it('formats amounts 1000–999999 as thousands with "к₽"', () => {
    expect(formatProductionCost(1000)).toBe('1к₽');
    expect(formatProductionCost(1500)).toBe('2к₽');   // Math.round(1.5) = 2
    expect(formatProductionCost(50_000)).toBe('50к₽');
    expect(formatProductionCost(999_999)).toBe('1000к₽');
  });

  it('formats amounts >= 1 000 000 as millions with "М₽"', () => {
    expect(formatProductionCost(1_000_000)).toBe('1.0М₽');
    expect(formatProductionCost(1_500_000)).toBe('1.5М₽');
    expect(formatProductionCost(2_750_000)).toBe('2.8М₽');
  });

  it('handles negative values without throwing (implementation-defined output)', () => {
    // We don't prescribe the output, but it must not throw
    expect(() => formatProductionCost(-100)).not.toThrow();
  });
});

// ─── isOrderOverdue ───────────────────────────────────────────────────────────

describe('isOrderOverdue', () => {
  const futureDeadline = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
  const pastDeadline = new Date(Date.now() - 86_400_000).toISOString();   // -1 day

  it('returns false when deadline_at is null', () => {
    expect(isOrderOverdue({ deadline_at: null, status: 'in_production' })).toBe(false);
  });

  it('returns false when deadline is in the future', () => {
    expect(isOrderOverdue({ deadline_at: futureDeadline, status: 'in_production' })).toBe(false);
    expect(isOrderOverdue({ deadline_at: futureDeadline, status: 'pending' })).toBe(false);
  });

  it('returns true when deadline is in the past and status is non-terminal', () => {
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'in_production' })).toBe(true);
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'pending' })).toBe(true);
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'sent' })).toBe(true);
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'quality_check' })).toBe(true);
  });

  it('returns false for terminal statuses even if deadline has passed', () => {
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'completed' })).toBe(false);
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'cancelled' })).toBe(false);
    expect(isOrderOverdue({ deadline_at: pastDeadline, status: 'returned' })).toBe(false);
  });
});
