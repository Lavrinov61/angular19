import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readBackendFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), '..', relativePath), 'utf8');
}

function extractTransactionConstraintTypes(sql: string): string[] {
  const match = sql.match(/CHECK\s*\(transaction_type IN\s*\(([\s\S]*?)\)\s*\)/);

  if (!match?.[1]) {
    throw new Error('transaction_type check constraint not found');
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((typeMatch) => typeMatch[1]);
}

const POS_MISC_CASHIER_ITEMS_MIGRATION = 'database/migrations/zz_20260621_pos_misc_cashier_items.sql';
const POS_RECEIPT_COPY_PRINT_MIGRATION = 'database/migrations/zz_20260625_pos_receipt_copy_print.sql';

describe('POS transaction type migrations', () => {
  it('keeps repeatable transaction type constraints monotonic', () => {
    const bankSettlementTypes = extractTransactionConstraintTypes(
      readBackendFile('database/migrations/zz_20260521_pos_bank_settlement_transaction.sql'),
    );
    const fiscalCorrectionTypes = extractTransactionConstraintTypes(
      readBackendFile('database/migrations/zz_20260526_pos_fiscal_correction_transaction.sql'),
    );
    const receiptCopyPrintTypes = extractTransactionConstraintTypes(
      readBackendFile(POS_RECEIPT_COPY_PRINT_MIGRATION),
    );

    expect(new Set(bankSettlementTypes)).toEqual(new Set(fiscalCorrectionTypes));
    expect(new Set(receiptCopyPrintTypes)).toEqual(new Set([...fiscalCorrectionTypes, 'receipt_copy_print']));
  });

  it('applies the fiscal correction transaction migration during deploy', () => {
    const deployScript = readRepoFile('deploy.sh');

    expect(deployScript).toContain('zz_20260526_pos_fiscal_correction_transaction.sql');
  });

  it('applies the POS miscellaneous cashier items migration during deploy', () => {
    const deployScript = readRepoFile('deploy.sh');

    expect(deployScript).toContain('zz_20260621_pos_misc_cashier_items.sql');
  });

  it('applies the POS receipt copy print migration during deploy', () => {
    const deployScript = readRepoFile('deploy.sh');

    expect(deployScript).toContain('zz_20260625_pos_receipt_copy_print.sql');
  });

  it('seeds the requested miscellaneous cashier catalog items', () => {
    const sql = readBackendFile(POS_MISC_CASHIER_ITEMS_MIGRATION);

    expect(sql).toContain("'pos-folder-skorosshivatel'");
    expect(sql).toContain("'pos-soft-binding'");
    expect(sql).toContain("'pos-binding-cover'");
    expect(sql).toContain("'pos-montage'");
    expect(sql).toContain("'pos-flyer-a5'");
    expect(sql).toContain("'pos-flyer-a6'");
    expect(sql).toContain("'Папка скоросшиватель'");
    expect(sql).toContain('150.00');
    expect(sql).toContain('100.00');
    expect(sql).toContain('0.00');
  });
});
