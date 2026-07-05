import db from '../database/db.js';
import type {
  PosFiscalReceiptSettingsInput,
  PosFiscalReceiptSettingsJsonb,
  PosFiscalSettingsInput,
  PosFiscalSettingsJsonb,
  PosFiscalShiftSettingsInput,
  PosFiscalShiftSettingsJsonb,
  PosFiscalSlipSettingsInput,
  PosFiscalSlipSettingsJsonb,
} from '../types/jsonb/pos-fiscal-settings-jsonb.js';
import type { PosFiscalSettingsRow } from '../types/views/pos-views.js';

interface UnknownRecord {
  [key: string]: unknown;
}

export interface PosFiscalSettings extends PosFiscalSettingsJsonb {
  studio_id: string;
  agent_id: string | null;
  enabled: boolean;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const DEFAULT_POS_FISCAL_SETTINGS: PosFiscalSettingsJsonb = {
  receipt_settings: {
    print_receipt: true,
    receipt_copies: 1,
    header_lines: [],
    footer_lines: [],
    show_cashier: true,
    show_receipt_number: true,
    show_order_number: true,
    show_customer: false,
    cashier_inn: null,
  },
  slip_settings: {
    print_bank_slip_on_atol: true,
    bank_slip_copies: 1,
    print_merchant_copy: true,
    print_customer_copy: true,
    include_rrn: true,
    include_approval_code: true,
    include_card_mask: true,
    include_sbp_id: true,
    footer_lines: [],
  },
  shift_settings: {
    auto_open_before_card_sbp: true,
    auto_close_on_last_pos_shift_close: false,
    print_open_report: true,
    print_close_report: true,
  },
};

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function lineArray(value: unknown, fallback: string[], maxLines = 4, maxLength = 64): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter((line): line is string => typeof line === 'string')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, maxLines)
    .map(line => line.slice(0, maxLength));
}

function cashierInnValue(value: unknown, fallback: string | null): string | null {
  if (typeof value !== 'string') return fallback;
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits.length === 10 || digits.length === 12 ? digits : null;
}

function normalizeReceiptSettings(value: unknown): PosFiscalReceiptSettingsJsonb {
  const defaults = DEFAULT_POS_FISCAL_SETTINGS.receipt_settings;
  const record = isUnknownRecord(value) ? value : {};

  return {
    print_receipt: boolValue(record['print_receipt'], defaults.print_receipt),
    receipt_copies: boundedInteger(record['receipt_copies'], defaults.receipt_copies, 1, 3),
    header_lines: lineArray(record['header_lines'], defaults.header_lines),
    footer_lines: lineArray(record['footer_lines'], defaults.footer_lines),
    show_cashier: boolValue(record['show_cashier'], defaults.show_cashier),
    show_receipt_number: boolValue(record['show_receipt_number'], defaults.show_receipt_number),
    show_order_number: boolValue(record['show_order_number'], defaults.show_order_number),
    show_customer: boolValue(record['show_customer'], defaults.show_customer),
    cashier_inn: cashierInnValue(record['cashier_inn'], defaults.cashier_inn),
  };
}

function normalizeSlipSettings(value: unknown): PosFiscalSlipSettingsJsonb {
  const defaults = DEFAULT_POS_FISCAL_SETTINGS.slip_settings;
  const record = isUnknownRecord(value) ? value : {};

  return {
    print_bank_slip_on_atol: boolValue(record['print_bank_slip_on_atol'], defaults.print_bank_slip_on_atol),
    bank_slip_copies: boundedInteger(record['bank_slip_copies'], defaults.bank_slip_copies, 1, 3),
    print_merchant_copy: boolValue(record['print_merchant_copy'], defaults.print_merchant_copy),
    print_customer_copy: boolValue(record['print_customer_copy'], defaults.print_customer_copy),
    include_rrn: boolValue(record['include_rrn'], defaults.include_rrn),
    include_approval_code: boolValue(record['include_approval_code'], defaults.include_approval_code),
    include_card_mask: boolValue(record['include_card_mask'], defaults.include_card_mask),
    include_sbp_id: boolValue(record['include_sbp_id'], defaults.include_sbp_id),
    footer_lines: lineArray(record['footer_lines'], defaults.footer_lines),
  };
}

function normalizeShiftSettings(value: unknown): PosFiscalShiftSettingsJsonb {
  const defaults = DEFAULT_POS_FISCAL_SETTINGS.shift_settings;
  const record = isUnknownRecord(value) ? value : {};

  return {
    auto_open_before_card_sbp: boolValue(record['auto_open_before_card_sbp'], defaults.auto_open_before_card_sbp),
    auto_close_on_last_pos_shift_close: boolValue(
      record['auto_close_on_last_pos_shift_close'],
      defaults.auto_close_on_last_pos_shift_close,
    ),
    print_open_report: boolValue(record['print_open_report'], defaults.print_open_report),
    print_close_report: boolValue(record['print_close_report'], defaults.print_close_report),
  };
}

function normalizeSettingsPayload(input: PosFiscalSettingsInput): PosFiscalSettingsJsonb {
  return {
    receipt_settings: normalizeReceiptSettings(input.receipt_settings),
    slip_settings: normalizeSlipSettings(input.slip_settings),
    shift_settings: normalizeShiftSettings(input.shift_settings),
  };
}

function settingsFromRow(studioId: string, row: PosFiscalSettingsRow | null): PosFiscalSettings {
  if (!row) {
    return {
      studio_id: studioId,
      agent_id: null,
      enabled: true,
      receipt_settings: normalizeReceiptSettings(null),
      slip_settings: normalizeSlipSettings(null),
      shift_settings: normalizeShiftSettings(null),
      updated_by: null,
      created_at: null,
      updated_at: null,
    };
  }

  return {
    studio_id: row.studio_id,
    agent_id: row.agent_id,
    enabled: row.enabled,
    receipt_settings: normalizeReceiptSettings(row.receipt_settings),
    slip_settings: normalizeSlipSettings(row.slip_settings),
    shift_settings: normalizeShiftSettings(row.shift_settings),
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function selectSettingsSql(): string {
  return `SELECT studio_id,
                 agent_id,
                 enabled,
                 receipt_settings,
                 slip_settings,
                 shift_settings,
                 updated_by,
                 created_at,
                 updated_at
          FROM pos_fiscal_settings
          WHERE studio_id = $1`;
}

export async function getPosFiscalSettings(studioId: string): Promise<PosFiscalSettings> {
  const row = await db.queryOne<PosFiscalSettingsRow>(selectSettingsSql(), [studioId]);
  return settingsFromRow(studioId, row);
}

export async function upsertPosFiscalSettings(
  studioId: string,
  input: PosFiscalSettingsInput,
  userId: string | null,
): Promise<PosFiscalSettings> {
  const normalized = normalizeSettingsPayload(input);
  const row = await db.queryOne<PosFiscalSettingsRow>(
    `INSERT INTO pos_fiscal_settings (
       studio_id,
       agent_id,
       enabled,
       receipt_settings,
       slip_settings,
       shift_settings,
       updated_by
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (studio_id) DO UPDATE
       SET agent_id = EXCLUDED.agent_id,
           enabled = EXCLUDED.enabled,
           receipt_settings = EXCLUDED.receipt_settings,
           slip_settings = EXCLUDED.slip_settings,
           shift_settings = EXCLUDED.shift_settings,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING studio_id,
               agent_id,
               enabled,
               receipt_settings,
               slip_settings,
               shift_settings,
               updated_by,
               created_at,
               updated_at`,
    [
      studioId,
      input.agent_id ?? null,
      input.enabled ?? true,
      JSON.stringify(normalized.receipt_settings),
      JSON.stringify(normalized.slip_settings),
      JSON.stringify(normalized.shift_settings),
      userId,
    ],
  );

  return settingsFromRow(studioId, row);
}

export function normalizePosFiscalSettingsInput(input: PosFiscalSettingsInput): PosFiscalSettingsJsonb {
  return normalizeSettingsPayload(input);
}

export function posFiscalSettingsForCommand(settings: PosFiscalSettings): PosFiscalSettingsJsonb {
  return {
    receipt_settings: normalizeReceiptSettings(settings.receipt_settings),
    slip_settings: normalizeSlipSettings(settings.slip_settings),
    shift_settings: normalizeShiftSettings(settings.shift_settings),
  };
}

export type {
  PosFiscalReceiptSettingsInput,
  PosFiscalReceiptSettingsJsonb,
  PosFiscalSettingsInput,
  PosFiscalShiftSettingsInput,
  PosFiscalShiftSettingsJsonb,
  PosFiscalSlipSettingsInput,
  PosFiscalSlipSettingsJsonb,
};
