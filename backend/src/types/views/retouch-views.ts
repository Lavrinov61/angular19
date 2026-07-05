import type { StudiosId } from '../generated/public/Studios.js';
import type { UsersId } from '../generated/public/Users.js';

export interface BestRetoucherRow {
  retoucher_id: UsersId;
  display_name: string;
}

export interface RetouchAvailabilityRow {
  employee_id: UsersId;
  studio_id: StudiosId;
  shift_start_at: Date | string;
  shift_end_at: Date | string;
  active_count: number | string | null;
}

export interface RetouchHistoryMetadata {
  [key: string]: unknown;
}

type PgNumeric = number | string | null;

export interface RetouchStatsSummaryRow {
  pending: PgNumeric;
  in_progress: PgNumeric;
  waiting_approval: PgNumeric;
  completed: PgNumeric;
  cancelled: PgNumeric;
  avg_minutes: PgNumeric;
  avg_revisions: PgNumeric;
  active_retouchers: PgNumeric;
}

export interface RetoucherStatsRow {
  assigned_to: UsersId | null;
  display_name: string | null;
  total: PgNumeric;
  completed: PgNumeric;
  avg_minutes: PgNumeric;
}

export interface RetouchStatsResult {
  summary: RetouchStatsSummaryRow;
  retouchers: RetoucherStatsRow[];
}
