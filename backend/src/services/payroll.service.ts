/**
 * Payroll Service
 *
 * Manages employee payout accounts (bank details) and
 * payout disbursement tracking (mark as paid).
 */

import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { EmployeePayoutAccountsId } from '../types/generated/public/EmployeePayoutAccounts.js';
import type { EmployeeCommissionPayoutsId } from '../types/generated/public/EmployeeCommissionPayouts.js';

const logger = createLogger('payroll');

// ─── Types ────────────────────────────────────────────────────────────────

export interface PayoutAccountRow {
  id: EmployeePayoutAccountsId;
  employee_id: UsersId;
  method: string;
  bank_name: string | null;
  account_identifier: string | null;
  recipient_name: string;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutListRow {
  id: EmployeeCommissionPayoutsId;
  employee_id: UsersId;
  employee_name: string;
  employee_photo: string | null;
  period: string;
  total_sales: string | null;
  total_receipts: number | null;
  total_commission: string | null;
  net_amount: string | null;
  status: string | null;
  approved_by: UsersId | null;
  approved_at: string | null;
  paid_by: UsersId | null;
  paid_at: string | null;
  payment_method: string | null;
  transfer_reference: string | null;
  payment_notes: string | null;
}

export interface PayoutRow {
  id: EmployeeCommissionPayoutsId;
  period: string;
  total_sales: string | null;
  total_receipts: number | null;
  total_commission: string | null;
  net_amount: string | null;
  status: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
}

// ─── Payout Accounts ─────────────────────────────────────────────────────

export async function getPayoutAccounts(employeeId: string): Promise<PayoutAccountRow[]> {
  return db.query<PayoutAccountRow>(
    `SELECT * FROM employee_payout_accounts
     WHERE employee_id = $1
     ORDER BY is_primary DESC, created_at DESC`,
    [employeeId],
  );
}

export async function upsertPayoutAccount(
  employeeId: string,
  data: {
    method: string;
    bank_name?: string | null;
    account_identifier?: string | null;
    recipient_name: string;
    notes?: string | null;
  },
): Promise<PayoutAccountRow> {
  const validMethods = ['phone_transfer', 'card_transfer', 'cash'];
  if (!validMethods.includes(data.method)) {
    throw new AppError(400, `method должен быть: ${validMethods.join(', ')}`);
  }

  const recipientName = data.recipient_name?.trim();
  if (!recipientName) {
    throw new AppError(400, 'recipient_name обязателен');
  }

  if (data.method !== 'cash' && !data.account_identifier?.trim()) {
    throw new AppError(400, 'account_identifier обязателен для безналичных методов');
  }

  // Partial unique index on (employee_id) WHERE is_primary = true
  // Try update first, then insert if no primary account exists
  const existing = await db.queryOne<PayoutAccountRow>(
    `UPDATE employee_payout_accounts
     SET method = $2, bank_name = $3, account_identifier = $4,
         recipient_name = $5, notes = $6, updated_at = NOW()
     WHERE employee_id = $1 AND is_primary = true
     RETURNING *`,
    [
      employeeId,
      data.method,
      data.bank_name ?? null,
      data.account_identifier?.trim() ?? null,
      recipientName,
      data.notes ?? null,
    ],
  );

  const result = existing ?? await db.queryOne<PayoutAccountRow>(
    `INSERT INTO employee_payout_accounts
       (employee_id, method, bank_name, account_identifier, recipient_name, notes, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING *`,
    [
      employeeId,
      data.method,
      data.bank_name ?? null,
      data.account_identifier?.trim() ?? null,
      recipientName,
      data.notes ?? null,
    ],
  );

  logger.info('Payout account upserted', { employeeId, method: data.method });
  return result!;
}

// ─── Payouts — Admin ─────────────────────────────────────────────────────

export async function getPayouts(filters: {
  status?: string;
  period?: string;
  employeeId?: string;
}): Promise<PayoutListRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`p.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.period) {
    conditions.push(`p.period = $${idx++}`);
    params.push(filters.period);
  }
  if (filters.employeeId) {
    conditions.push(`p.employee_id = $${idx++}`);
    params.push(filters.employeeId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query<PayoutListRow>(
    `SELECT
       p.id, p.employee_id, u.display_name AS employee_name, u.photo_url AS employee_photo,
       p.period, p.total_sales, p.total_receipts, p.total_commission,
       p.net_amount, p.status,
       p.approved_by, p.approved_at,
       p.paid_by, p.paid_at,
       p.payment_method, p.transfer_reference, p.payment_notes
     FROM employee_commission_payouts p
     JOIN users u ON u.id = p.employee_id
     ${where}
     ORDER BY p.period DESC, p.total_commission DESC`,
    params,
  );
}

// ─── Payouts — Employee ──────────────────────────────────────────────────

export async function getMyPayouts(
  employeeId: string,
  period?: string,
): Promise<PayoutRow[]> {
  if (period) {
    return db.query<PayoutRow>(
      `SELECT id, period, total_sales, total_receipts, total_commission,
              net_amount, status, approved_at, paid_at, payment_method
       FROM employee_commission_payouts
       WHERE employee_id = $1 AND period = $2
       ORDER BY period DESC`,
      [employeeId, period],
    );
  }

  return db.query<PayoutRow>(
    `SELECT id, period, total_sales, total_receipts, total_commission,
            net_amount, status, approved_at, paid_at, payment_method
     FROM employee_commission_payouts
     WHERE employee_id = $1
     ORDER BY period DESC`,
    [employeeId],
  );
}

// ─── Mark as Paid ────────────────────────────────────────────────────────

export async function markPayoutAsPaid(
  payoutId: string,
  paidBy: string,
  data: {
    net_amount: number;
    payment_method: string;
    payout_account_id?: string | null;
    transfer_reference?: string | null;
    payment_notes?: string | null;
  },
): Promise<{ id: EmployeeCommissionPayoutsId; status: string; paid_at: string }> {
  if (!data.net_amount || data.net_amount <= 0) {
    throw new AppError(400, 'net_amount должен быть больше 0');
  }

  const validMethods = ['phone_transfer', 'card_transfer', 'cash'];
  if (!validMethods.includes(data.payment_method)) {
    throw new AppError(400, `payment_method должен быть: ${validMethods.join(', ')}`);
  }

  // Only approved payouts can be marked as paid
  const current = await db.queryOne<{ status: string }>(
    `SELECT status FROM employee_commission_payouts WHERE id = $1`,
    [payoutId],
  );

  if (!current) {
    throw new AppError(404, 'Выплата не найдена');
  }
  if (current.status !== 'approved') {
    throw new AppError(400, `Выплата в статусе "${current.status}", можно оплатить только "approved"`);
  }

  const result = await db.queryOne<{
    id: EmployeeCommissionPayoutsId;
    status: string;
    paid_at: string;
  }>(
    `UPDATE employee_commission_payouts
     SET status = 'paid',
         paid_by = $2,
         paid_at = NOW(),
         net_amount = $3,
         payment_method = $4,
         payout_account_id = $5,
         transfer_reference = $6,
         payment_notes = $7
     WHERE id = $1 AND status = 'approved'
     RETURNING id, status, paid_at`,
    [
      payoutId,
      paidBy,
      data.net_amount,
      data.payment_method,
      data.payout_account_id ?? null,
      data.transfer_reference ?? null,
      data.payment_notes ?? null,
    ],
  );

  logger.info('Payout marked as paid', {
    payoutId,
    paidBy,
    netAmount: data.net_amount,
    method: data.payment_method,
  });

  return result!;
}
