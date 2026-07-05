export interface PosFiscalReceiptSettingsJsonb {
  print_receipt: boolean;
  receipt_copies: number;
  header_lines: string[];
  footer_lines: string[];
  show_cashier: boolean;
  show_receipt_number: boolean;
  show_order_number: boolean;
  show_customer: boolean;
  cashier_inn: string | null;
}

export interface PosFiscalSlipSettingsJsonb {
  print_bank_slip_on_atol: boolean;
  bank_slip_copies: number;
  print_merchant_copy: boolean;
  print_customer_copy: boolean;
  include_rrn: boolean;
  include_approval_code: boolean;
  include_card_mask: boolean;
  include_sbp_id: boolean;
  footer_lines: string[];
}

export interface PosFiscalShiftSettingsJsonb {
  auto_open_before_card_sbp: boolean;
  auto_close_on_last_pos_shift_close: boolean;
  print_open_report: boolean;
  print_close_report: boolean;
}

export interface PosFiscalSettingsJsonb {
  receipt_settings: PosFiscalReceiptSettingsJsonb;
  slip_settings: PosFiscalSlipSettingsJsonb;
  shift_settings: PosFiscalShiftSettingsJsonb;
}

export type PosFiscalReceiptSettingsInput = Partial<PosFiscalReceiptSettingsJsonb>;
export type PosFiscalSlipSettingsInput = Partial<PosFiscalSlipSettingsJsonb>;
export type PosFiscalShiftSettingsInput = Partial<PosFiscalShiftSettingsJsonb>;

export interface PosFiscalSettingsInput {
  agent_id?: string | null;
  enabled?: boolean;
  receipt_settings?: PosFiscalReceiptSettingsInput;
  slip_settings?: PosFiscalSlipSettingsInput;
  shift_settings?: PosFiscalShiftSettingsInput;
}
