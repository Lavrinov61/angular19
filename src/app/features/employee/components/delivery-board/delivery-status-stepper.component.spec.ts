import {
  DELIVERY_STEPS,
  deliveryStepIndex,
  isTerminalShipmentStatus,
} from './delivery-status-stepper.component';
import type { ShipmentStatus } from '../../../../core/services/delivery.service';

describe('delivery-status-stepper logic', () => {
  it('DELIVERY_STEPS — 6 линейных шагов в правильном порядке', () => {
    expect(DELIVERY_STEPS.map((s) => s.key)).toEqual([
      'pending', 'created', 'courier_assigned', 'picked_up', 'in_transit', 'delivered',
    ]);
  });

  describe('deliveryStepIndex', () => {
    it('null → 0 (pending)', () => {
      expect(deliveryStepIndex(null)).toBe(0);
    });

    it('каждый известный статус → свой индекс', () => {
      expect(deliveryStepIndex('pending')).toBe(0);
      expect(deliveryStepIndex('created')).toBe(1);
      expect(deliveryStepIndex('courier_assigned')).toBe(2);
      expect(deliveryStepIndex('picked_up')).toBe(3);
      expect(deliveryStepIndex('in_transit')).toBe(4);
      expect(deliveryStepIndex('delivered')).toBe(5);
    });

    it('неизвестный статус → 0 (без падения)', () => {
      expect(deliveryStepIndex('weird_status' as ShipmentStatus)).toBe(0);
    });

    it('терминальные статусы тоже не дают -1', () => {
      // cancelled/failed нет в линейке — фолбэк на 0 (рендерится отдельная плашка)
      expect(deliveryStepIndex('cancelled')).toBe(0);
      expect(deliveryStepIndex('failed')).toBe(0);
    });
  });

  describe('isTerminalShipmentStatus', () => {
    it('cancelled и failed — терминальные', () => {
      expect(isTerminalShipmentStatus('cancelled')).toBe(true);
      expect(isTerminalShipmentStatus('failed')).toBe(true);
    });

    it('активные статусы и null — не терминальные', () => {
      expect(isTerminalShipmentStatus(null)).toBe(false);
      expect(isTerminalShipmentStatus('pending')).toBe(false);
      expect(isTerminalShipmentStatus('in_transit')).toBe(false);
      expect(isTerminalShipmentStatus('delivered')).toBe(false);
    });
  });
});
