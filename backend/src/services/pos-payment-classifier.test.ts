import { describe, expect, it } from 'vitest';
import { classifyFailedPayment, effectivePaymentStatus } from './pos-payment-classifier.js';

describe('classifyFailedPayment', () => {
  describe('in_doubt — обрыв/таймаут, ответ банка не получен', () => {
    it('реальный сэмпл инцидента: Connection error на :9015 (op1, без RRN)', () => {
      // pos_transactions 6eb39456 — 18:58:02, обрыв связи касса↔INPAS драйвер.
      expect(
        classifyFailedPayment({
          error_message: 'Connection error: error sending request for url (http://localhost:9015)',
          rrn: null,
        }),
      ).toBe('in_doubt');
    });

    it('реальный сэмпл инцидента: «Вышел таймаут ожидания ответа платежа» (field 19)', () => {
      // INPAS field 19 при перезагрузке терминала, field 39=0, RRN отсутствует.
      expect(
        classifyFailedPayment({
          error_message: 'Вышел таймаут ожидания ответа платежа',
          rrn: null,
        }),
      ).toBe('in_doubt');
    });

    it('error sending request (терминал офлайн, запрос не доставлен)', () => {
      expect(
        classifyFailedPayment({ error_message: 'error sending request', rrn: null }),
      ).toBe('in_doubt');
    });

    it('пустой error_message без RRN → ответ не получен вовсе', () => {
      expect(classifyFailedPayment({ error_message: '', rrn: null })).toBe('in_doubt');
      expect(classifyFailedPayment({ error_message: null, rrn: null })).toBe('in_doubt');
      expect(classifyFailedPayment({})).toBe('in_doubt');
    });

    it('сетевые маркеры ETIMEDOUT/ECONNRESET → in_doubt', () => {
      expect(classifyFailedPayment({ error_message: 'connect ETIMEDOUT', rrn: null })).toBe('in_doubt');
      expect(classifyFailedPayment({ error_message: 'socket hang up ECONNRESET', rrn: null })).toBe('in_doubt');
    });
  });

  describe('failed — явный отказ терминала, деньги не списаны', () => {
    it('наличие RRN всегда → банк ответил → failed (исход определён)', () => {
      expect(
        classifyFailedPayment({ error_message: 'Connection error', rrn: '123456789012' }),
      ).toBe('failed');
    });

    it('«Транзакция отклонена» → failed', () => {
      expect(
        classifyFailedPayment({ error_message: 'Транзакция отклонена банком', rrn: null }),
      ).toBe('failed');
    });

    it('«Недостаточно средств» → failed', () => {
      expect(
        classifyFailedPayment({ error_message: 'Недостаточно средств на карте', rrn: null }),
      ).toBe('failed');
    });

    it('Error 16 / неверный PIN → failed', () => {
      expect(classifyFailedPayment({ error_message: 'Error 16: declined', rrn: null })).toBe('failed');
      expect(classifyFailedPayment({ error_message: 'Неверный ПИН', rrn: null })).toBe('failed');
    });

    it('отмена клиентом → failed', () => {
      expect(
        classifyFailedPayment({ error_message: 'Операция отменена клиентом', rrn: null }),
      ).toBe('failed');
    });

    it('нераспознанный непустой текст без маркера обрыва → failed (консервативно)', () => {
      expect(
        classifyFailedPayment({ error_message: 'Карта не поддерживается', rrn: null }),
      ).toBe('failed');
    });

    it('явный отказ доминирует над случайным словом timeout в тексте отказа', () => {
      // «отклонен» (decline-маркер) проверяется раньше маркеров обрыва.
      expect(
        classifyFailedPayment({ error_message: 'Операция отклонена: session timeout на стороне банка', rrn: null }),
      ).toBe('failed');
    });
  });
});

describe('effectivePaymentStatus', () => {
  it('payment_resolution доминирует над status', () => {
    expect(effectivePaymentStatus({ status: 'failed', payment_resolution: 'in_doubt' })).toBe('in_doubt');
    expect(effectivePaymentStatus({ status: 'failed', payment_resolution: 'resolved_paid' })).toBe('resolved_paid');
  });

  it('пустой/отсутствующий resolution → берём status', () => {
    expect(effectivePaymentStatus({ status: 'completed', payment_resolution: null })).toBe('completed');
    expect(effectivePaymentStatus({ status: 'completed', payment_resolution: '' })).toBe('completed');
    expect(effectivePaymentStatus({ status: 'pending' })).toBe('pending');
  });

  it('оба пустые → null', () => {
    expect(effectivePaymentStatus({})).toBeNull();
    expect(effectivePaymentStatus({ status: null, payment_resolution: null })).toBeNull();
  });
});
