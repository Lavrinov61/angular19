import express, { Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getPayoutAccounts,
  upsertPayoutAccount,
  getPayouts,
  getMyPayouts,
  markPayoutAsPaid,
} from '../services/payroll.service.js';

const router = express.Router();

// ============================================================================
// GET /api/payroll/my-account — мои реквизиты (employee)
// ============================================================================
router.get('/my-account', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const accounts = await getPayoutAccounts(req.user.id);
  res.json({ success: true, data: accounts });
});

// ============================================================================
// PUT /api/payroll/my-account — создать/обновить реквизиты (employee)
// ============================================================================
router.put('/my-account', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const { method, bank_name, account_identifier, recipient_name, notes } = req.body;

  if (!recipient_name?.trim()) {
    throw new AppError(400, 'recipient_name обязателен');
  }

  const account = await upsertPayoutAccount(req.user.id, {
    method,
    bank_name,
    account_identifier,
    recipient_name,
    notes,
  });

  res.json({ success: true, data: account });
});

// ============================================================================
// GET /api/payroll/employees/:id/account — реквизиты сотрудника (admin)
// ============================================================================
router.get('/employees/:id/account', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    throw new AppError(403, 'Только admin/manager');
  }

  const accounts = await getPayoutAccounts(req.params['id']!);
  res.json({ success: true, data: accounts });
});

// ============================================================================
// GET /api/payroll/payouts — все выплаты (admin, filters)
// ============================================================================
router.get('/payouts', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    throw new AppError(403, 'Только admin/manager');
  }

  const status = req.query['status'] as string | undefined;
  const period = req.query['period'] as string | undefined;
  const employeeId = req.query['employee_id'] as string | undefined;

  const payouts = await getPayouts({ status, period, employeeId });
  res.json({ success: true, data: payouts });
});

// ============================================================================
// GET /api/payroll/my-payouts — мои выплаты (employee)
// ============================================================================
router.get('/my-payouts', authenticateToken, requirePermission('shifts:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  const period = req.query['period'] as string | undefined;
  const payouts = await getMyPayouts(req.user.id, period);
  res.json({ success: true, data: payouts });
});

// ============================================================================
// POST /api/payroll/payouts/:id/pay — отметить как оплаченный (admin)
// ============================================================================
router.post('/payouts/:id/pay', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) return;

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    throw new AppError(403, 'Только admin/manager');
  }

  const { net_amount, payment_method, payout_account_id, transfer_reference, payment_notes } = req.body;

  const result = await markPayoutAsPaid(req.params['id']!, req.user.id, {
    net_amount,
    payment_method,
    payout_account_id,
    transfer_reference,
    payment_notes,
  });

  res.json({ success: true, data: result });
});

export default router;
