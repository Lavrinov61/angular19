/**
 * Prometheus metrics для Bitrix Drive import.
 * Регистрируются в global registry из metrics.service.ts.
 */

import client from 'prom-client';
import { getMetricsRegistry } from '../metrics.service.js';

const registry = getMetricsRegistry();

export const filesImportedCounter = new client.Counter({
  name: 'bitrix_import_files_total',
  help: 'Bitrix24 Drive files processed by the importer',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const bytesImportedCounter = new client.Counter({
  name: 'bitrix_import_bytes_total',
  help: 'Total bytes imported from Bitrix24 Drive',
  registers: [registry],
});

export const errorsCounter = new client.Counter({
  name: 'bitrix_import_errors_total',
  help: 'Errors during Bitrix24 Drive import',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export function recordImportedFile(): void {
  filesImportedCounter.inc({ status: 'imported' });
}

export function recordSkippedFile(): void {
  filesImportedCounter.inc({ status: 'skipped' });
}

export function recordBytes(bytes: number): void {
  if (bytes > 0) bytesImportedCounter.inc(bytes);
}

export function recordError(kind: string): void {
  errorsCounter.inc({ kind });
}
