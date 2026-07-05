import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../database/db.js';
import { processOrphanPayments } from './pos-orphan-payment-sweep.service.js';

const findOrphanPayments = vi.hoisted(() => vi.fn());
const notificationCreate = vi.hoisted(() => vi.fn());
const broadcastToRoom = vi.hoisted(() => vi.fn());
const enqueueOutbound = vi.hoisted(() => vi.fn());

// Конфиг с флагами; перезаписываем поля per-test.
const posConfig = vi.hoisted(() => ({
  orphanDetectEnabled: true,
  orphanClientNotifyEnabled: false,
  orphanPaymentAgeMinutes: 5,
  orphanCheckIntervalMs: 180000,
}));

vi.mock('../database/db.js', () => ({
  default: { query: vi.fn(), queryOne: vi.fn() },
}));
vi.mock('../config/index.js', () => ({ config: { pos: posConfig } }));
vi.mock('./pos.service.js', () => ({ findOrphanPayments }));
vi.mock('./notification.service.js', () => ({ NotificationService: { create: notificationCreate } }));
vi.mock('../websocket/broadcast-to-room.js', () => ({ broadcastToRoom }));
vi.mock('./connectors/pipeline/outbound-worker.js', () => ({ enqueueOutbound }));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function orphanRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'pay-1',
    studio_id: 'studio-1',
    amount: '525.00',
    order_id: null,
    status: 'completed',
    rrn: '615712740554',
    initiated_by: 'cashier-1',
    initiated_by_name: 'Ольга',
    completed_at: '2026-06-06T12:14:45.261Z',
    command_payload: null,
    ...over,
  };
}

describe('processOrphanPayments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    posConfig.orphanDetectEnabled = true;
    posConfig.orphanClientNotifyEnabled = false;
    // CAS orphan_notified_at по умолчанию успешен (1 строка).
    vi.mocked(db.queryOne).mockResolvedValue({ id: 'pay-1' });
  });

  it('флаг OFF — детектор не запускается', async () => {
    posConfig.orphanDetectEnabled = false;
    await processOrphanPayments();
    expect(findOrphanPayments).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('уведомляет сотрудника: studio-room broadcast + персональная notification (initiated_by есть)', async () => {
    findOrphanPayments.mockResolvedValue([orphanRow()]);
    await processOrphanPayments();

    expect(broadcastToRoom).toHaveBeenCalledWith(
      'pos:orphan_payment',
      'studio:studio-1',
      expect.objectContaining({ payment_id: 'pay-1', amount: 525 }),
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'cashier-1', type: 'payment_confirmed' }),
    );
  });

  it('P1.3: initiated_by NULL → только studio broadcast, без персональной notification', async () => {
    findOrphanPayments.mockResolvedValue([orphanRow({ id: 'pay-legacy', initiated_by: null })]);
    await processOrphanPayments();

    expect(broadcastToRoom).toHaveBeenCalledWith('pos:orphan_payment', 'studio:studio-1', expect.any(Object));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('CAS orphan_notified_at идемпотентен: 0 строк → не шлём уведомление', async () => {
    findOrphanPayments.mockResolvedValue([orphanRow()]);
    vi.mocked(db.queryOne).mockResolvedValue(null); // CAS уже отработал ранее
    await processOrphanPayments();

    expect(broadcastToRoom).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('клиент НЕ уведомляется при флаге orphanClientNotifyEnabled=false', async () => {
    findOrphanPayments.mockResolvedValue([
      orphanRow({ command_payload: { snapshot: { customerPhone: '79001234567' } } }),
    ]);
    await processOrphanPayments();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('клиент уведомляется один раз при флаге ON, диалоге и ре-чеке orphan (P1.4)', async () => {
    posConfig.orphanClientNotifyEnabled = true;
    findOrphanPayments.mockResolvedValue([
      orphanRow({ command_payload: { snapshot: { customerPhone: '79001234567' } } }),
    ]);
    // 1) CAS orphan_notified_at → {id}; 2) resolveClientConversation → диалог;
    // 3) CAS orphan_client_notified_at (ре-чек) → {id}.
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'pay-1' })
      .mockResolvedValueOnce({ id: 'conv-1', channel: 'telegram', external_chat_id: 'tg-1' })
      .mockResolvedValueOnce({ id: 'pay-1' });

    await processOrphanPayments();

    expect(enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        externalChatId: 'tg-1',
        conversationId: 'conv-1',
        dedupKey: 'pos-orphan-client:pay-1',
        content: 'Здравствуйте! Ваша оплата на 525 ₽ получена, спасибо.',
      }),
    );
  });

  it('клиент НЕ уведомляется при флаге ON, но без телефона в снимке (нет привязки)', async () => {
    posConfig.orphanClientNotifyEnabled = true;
    findOrphanPayments.mockResolvedValue([orphanRow({ command_payload: null })]);
    await processOrphanPayments();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('P1.4: ре-чек orphan_client_notified_at = 0 строк (кассир оформил чек) → клиенту не шлём', async () => {
    posConfig.orphanClientNotifyEnabled = true;
    findOrphanPayments.mockResolvedValue([
      orphanRow({ command_payload: { snapshot: { customerPhone: '79001234567' } } }),
    ]);
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'pay-1' }) // staff CAS
      .mockResolvedValueOnce({ id: 'conv-1', channel: 'telegram', external_chat_id: 'tg-1' }) // диалог
      .mockResolvedValueOnce(null); // client CAS — оплата уже не orphan

    await processOrphanPayments();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it('изоляция ошибки между строками: throw на CAS первого orphan → второй всё равно обработан', async () => {
    findOrphanPayments.mockResolvedValue([
      orphanRow({ id: 'pay-1', studio_id: 'studio-1' }),
      orphanRow({ id: 'pay-2', studio_id: 'studio-2' }),
    ]);
    // 1-я строка: CAS бросает; 2-я строка: CAS успешен.
    vi.mocked(db.queryOne)
      .mockRejectedValueOnce(new Error('db boom on pay-1'))
      .mockResolvedValueOnce({ id: 'pay-2' });

    await processOrphanPayments();

    // Второй orphan получил уведомление (broadcast в его studio-room).
    expect(broadcastToRoom).toHaveBeenCalledWith('pos:orphan_payment', 'studio:studio-2', expect.any(Object));
    expect(broadcastToRoom).not.toHaveBeenCalledWith('pos:orphan_payment', 'studio:studio-1', expect.any(Object));
  });
});
