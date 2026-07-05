import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('PrintQueueComponent printer controls', () => {
  it('exposes printer-level queue pause and resume controls', () => {
    const componentSource = readFileSync(
      join(process.cwd(), 'src/app/features/employee/components/print-queue/print-queue.component.ts'),
      'utf8',
    );
    const stateSource = readFileSync(
      join(process.cwd(), 'src/app/features/employee/services/print-queue-state.service.ts'),
      'utf8',
    );

    expect(componentSource).toContain('state.pausePrinterQueue(printer)');
    expect(componentSource).toContain('state.resumePrinterQueue(printer)');
    expect(componentSource).toContain('Очередь принтера на паузе');
    expect(stateSource).toContain('pausePrinterQueue(printer: Printer)');
    expect(stateSource).toContain('resumePrinterQueue(printer: Printer)');
    expect(stateSource).toContain('this.printApi.pausePrinterQueue');
    expect(stateSource).toContain('this.printApi.resumePrinterQueue');
  });
});
