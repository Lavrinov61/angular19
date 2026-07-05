import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PosCardProgressComponent source', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/features/employee/components/pos/dialogs/pos-card-progress.component.ts'),
    'utf8',
  );

  it('shows that card approval is waiting for fiscalization instead of success', () => {
    expect(source).toContain("'fiscalizing'");
    expect(source).toContain('Оплата одобрена');
    expect(source).toContain('пробиваем чек');
  });

  it('asks the employee to retry the receipt when fiscalization fails after bank approval', () => {
    expect(source).toContain("'fiscal_error'");
    expect(source).toContain('Чек не пробит');
    expect(source).toContain('Повторить чек');
  });

  it('does not present terminal reversal as the primary no-paper recovery path', () => {
    expect(source).not.toContain("'reversing'");
    expect(source).not.toContain("'reversed'");
    expect(source).not.toContain("'reversal_error'");
    expect(source).not.toContain('Отмена не подтверждена');
  });
});
