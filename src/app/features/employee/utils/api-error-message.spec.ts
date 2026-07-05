import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { employeeApiErrorMessage } from './api-error-message';

describe('employeeApiErrorMessage', () => {
  it('keeps readable employee-facing Russian messages', () => {
    expect(employeeApiErrorMessage(
      new Error('Нет бумаги в ККТ. Вставьте бумагу и повторите чек.'),
      'Ошибка операции',
    )).toBe('Нет бумаги в ККТ. Вставьте бумагу и повторите чек.');
  });

  it('replaces mojibake terminal messages with a readable fallback', () => {
    expect(employeeApiErrorMessage(
      new Error('��������������������������������'),
      'терминал не подтвердил отмену оплаты',
    )).toBe('терминал не подтвердил отмену оплаты');
  });

  it('sanitizes unreadable HTTP error bodies', () => {
    const error = new HttpErrorResponse({
      error: { message: '������ �������� �� ����������' },
      status: 500,
    });

    expect(employeeApiErrorMessage(error, 'Операция не подтверждена')).toBe('Операция не подтверждена');
  });
});
