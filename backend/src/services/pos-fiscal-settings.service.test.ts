import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb, resetMockDb } from '../test-utils/mock-db.js';

vi.mock('../database/db.js', () => ({
  default: mockDb,
}));

const {
  DEFAULT_POS_FISCAL_SETTINGS,
  getPosFiscalSettings,
  upsertPosFiscalSettings,
} = await import('./pos-fiscal-settings.service.js');

const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('pos-fiscal-settings.service', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('returns default ATOL27F print settings when studio has no row', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const settings = await getPosFiscalSettings(STUDIO_ID);

    expect(settings.studio_id).toBe(STUDIO_ID);
    expect(settings.receipt_settings.receipt_copies).toBe(1);
    expect(settings.slip_settings.print_bank_slip_on_atol).toBe(true);
    expect(settings.shift_settings.auto_open_before_card_sbp).toBe(true);
    expect(settings.shift_settings.auto_close_on_last_pos_shift_close).toBe(false);
  });

  it('merges stored JSON with defaults', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: null,
      enabled: true,
      receipt_settings: {
        receipt_copies: 2,
        show_customer: true,
        footer_lines: ['Спасибо'],
      },
      slip_settings: {
        bank_slip_copies: 2,
        include_rrn: false,
      },
      shift_settings: {
        auto_close_on_last_pos_shift_close: false,
      },
      updated_by: USER_ID,
      created_at: '2026-05-21T09:00:00.000Z',
      updated_at: '2026-05-21T09:00:00.000Z',
    });

    const settings = await getPosFiscalSettings(STUDIO_ID);

    expect(settings.receipt_settings.receipt_copies).toBe(2);
    expect(settings.receipt_settings.print_receipt).toBe(DEFAULT_POS_FISCAL_SETTINGS.receipt_settings.print_receipt);
    expect(settings.receipt_settings.footer_lines).toEqual(['Спасибо']);
    expect(settings.slip_settings.bank_slip_copies).toBe(2);
    expect(settings.slip_settings.include_rrn).toBe(false);
    expect(settings.slip_settings.include_approval_code).toBe(true);
    expect(settings.shift_settings.auto_close_on_last_pos_shift_close).toBe(false);
    expect(settings.shift_settings.auto_open_before_card_sbp).toBe(true);
  });

  it('normalizes and persists bounded print settings', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({
      studio_id: STUDIO_ID,
      agent_id: null,
      enabled: true,
      receipt_settings: {
        print_receipt: true,
        receipt_copies: 3,
        header_lines: ['Своё Фото', 'x'.repeat(64)],
        footer_lines: ['line-1', 'line-2', 'line-3', 'line-4'],
        show_cashier: true,
        show_receipt_number: true,
        show_order_number: true,
        show_customer: true,
        cashier_inn: '123456789012',
      },
      slip_settings: {
        print_bank_slip_on_atol: true,
        bank_slip_copies: 1,
        print_merchant_copy: true,
        print_customer_copy: true,
        include_rrn: false,
        include_approval_code: true,
        include_card_mask: true,
        include_sbp_id: true,
        footer_lines: ['Храните слип до сверки'],
      },
      shift_settings: {
        auto_open_before_card_sbp: true,
        auto_close_on_last_pos_shift_close: true,
        print_open_report: true,
        print_close_report: true,
      },
      updated_by: USER_ID,
      created_at: '2026-05-21T09:00:00.000Z',
      updated_at: '2026-05-21T09:00:00.000Z',
    });

    const settings = await upsertPosFiscalSettings(STUDIO_ID, {
      receipt_settings: {
        receipt_copies: 9,
        header_lines: ['  Своё Фото  ', '', 'x'.repeat(100)],
        show_customer: true,
        cashier_inn: ' 123456789012 ',
      },
      slip_settings: {
        bank_slip_copies: 0,
        include_rrn: false,
        footer_lines: ['  Храните слип до сверки  '],
      },
      shift_settings: {
        auto_close_on_last_pos_shift_close: true,
      },
    }, USER_ID);

    expect(settings.receipt_settings.receipt_copies).toBe(3);
    expect(settings.receipt_settings.header_lines).toEqual(['Своё Фото', 'x'.repeat(64)]);
    expect(settings.receipt_settings.cashier_inn).toBe('123456789012');
    expect(settings.slip_settings.bank_slip_copies).toBe(1);
    expect(settings.slip_settings.include_rrn).toBe(false);
    expect(settings.slip_settings.footer_lines).toEqual(['Храните слип до сверки']);
    expect(settings.shift_settings.auto_open_before_card_sbp).toBe(true);
    expect(settings.shift_settings.auto_close_on_last_pos_shift_close).toBe(true);
    expect(mockDb.queryOne).toHaveBeenCalledTimes(1);
  });
});
