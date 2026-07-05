/** DB row shape: EmployeeShifts + JOINed fields from query */
interface ShiftRow {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_date: Date | string;
  start_time: Date | string;
  end_time: Date | string;
  status: string | null;
  notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  checked_in_at: Date | string | null;
  checked_out_at: Date | string | null;
  cash_at_open?: string | number | null;
  cash_at_close?: string | number | null;
  commission_total: string | null;
  sales_total: string | null;
  receipts_count: number | null;
  online_earnings: string | null;
  online_count: number | null;
  base_pay_rate?: string | null;
  shift_kind?: string | null;
  employee_name?: string;
  employee_phone?: string;
  studio_name?: string;
  studio_address?: string | null;
  location_code?: string | null;
  linked_accounts?: unknown;
}

/** API response shape — matches frontend EmployeeShift interface */
export interface ShiftResponse {
  id: string;
  employee_id: string;
  studio_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cash_at_open: number | null;
  cash_at_close: number | null;
  online_earnings: number;
  online_count: number;
  commission_total: number;
  sales_total: number;
  receipts_count: number;
  base_pay_rate: number | null;
  shift_kind: string;
  is_virtual: boolean;
  employee_name?: string;
  employee_phone?: string;
  studio_name?: string;
  studio_address?: string | null;
  location_code?: string | null;
  linked_accounts?: unknown;
}

/**
 * Normalize pg Date|string → 'YYYY-MM-DD'.
 *
 * pg driver creates Date objects for `date` columns via `new Date(y, m-1, d)` — LOCAL timezone.
 * On UTC+3 server: '2026-03-13' → Date(2026-03-12T21:00:00Z) → getUTCDate() = 12 (WRONG).
 * LOCAL methods (getFullYear/getMonth/getDate) return the correct original date
 * because pg used local timezone to construct the Date.
 *
 * Preferred: receive as string from SQL (`shift_date::text`) so this branch never executes.
 */
function toDateString(val: Date | string): string {
  if (typeof val === 'string') return val.slice(0, 10);
  return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
}

/** Normalize pg time column. pg returns 'time' as string '09:00:00', not Date. */
function toTimeString(val: Date | string): string {
  if (typeof val === 'string') return val;
  return val.toISOString().slice(11, 19);
}

/** Normalize pg timestamptz Date|string|null → ISO string */
function toISOOrNull(val: Date | string | null | undefined): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return val.toISOString();
}

/** Transform DB row → API response */
export function toShiftResponse(row: ShiftRow): ShiftResponse {
  const shiftKind = row.shift_kind ?? 'studio';
  return {
    id: row.id,
    employee_id: row.employee_id,
    studio_id: row.studio_id,
    shift_date: toDateString(row.shift_date),
    start_time: toTimeString(row.start_time),
    end_time: toTimeString(row.end_time),
    status: row.status ?? 'scheduled',
    notes: row.notes ?? null,
    created_at: toISOOrNull(row.created_at),
    updated_at: toISOOrNull(row.updated_at),
    checked_in_at: toISOOrNull(row.checked_in_at),
    checked_out_at: toISOOrNull(row.checked_out_at),
    cash_at_open: row.cash_at_open == null ? null : parseFloat(String(row.cash_at_open)),
    cash_at_close: row.cash_at_close == null ? null : parseFloat(String(row.cash_at_close)),
    online_earnings: parseFloat(String(row.online_earnings ?? '0')),
    online_count: Number(row.online_count ?? 0),
    commission_total: parseFloat(String(row.commission_total ?? '0')),
    sales_total: parseFloat(String(row.sales_total ?? '0')),
    receipts_count: Number(row.receipts_count ?? 0),
    base_pay_rate: row.base_pay_rate == null ? null : parseFloat(String(row.base_pay_rate)),
    shift_kind: shiftKind,
    is_virtual: shiftKind === 'virtual',
    ...(row.employee_name !== undefined && { employee_name: row.employee_name }),
    ...(row.employee_phone !== undefined && { employee_phone: row.employee_phone }),
    ...(row.studio_name !== undefined && { studio_name: row.studio_name }),
    ...(row.studio_address !== undefined && { studio_address: row.studio_address }),
    ...(row.location_code !== undefined && { location_code: row.location_code }),
    ...(row.linked_accounts !== undefined && { linked_accounts: row.linked_accounts }),
  };
}
