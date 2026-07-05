import { Printer, BridgePrinterStatus } from '../services/print-api.service';

export interface PrinterGroup {
  printers: Printer[];
  studioId: string;
  printerType: string;
  allOnline: boolean;
}

export function detectPrinterGroups(
  printers: Printer[],
  statuses: BridgePrinterStatus[],
): PrinterGroup[] {
  const byKey = new Map<string, Printer[]>();
  for (const p of printers) {
    if (!p.studio_id) continue;
    const key = `${p.studio_id}__${p.printer_type}`;
    const arr = byKey.get(key) ?? [];
    arr.push(p);
    byKey.set(key, arr);
  }

  return Array.from(byKey.values())
    .filter(group => group.length >= 2)
    .map(group => ({
      printers: group,
      studioId: group[0].studio_id!,
      printerType: group[0].printer_type,
      allOnline: group.every(p =>
        statuses.some(s =>
          s.printer_name === p.cups_printer_name && s.online,
        ),
      ),
    }));
}

export function splitJobsRoundRobin<T extends { printer_id: string }>(
  rows: T[],
  printerIds: string[],
): T[][] {
  if (!printerIds.length) return [rows];
  const buckets: T[][] = printerIds.map(() => []);
  rows.forEach((row, i) => {
    const idx = i % printerIds.length;
    buckets[idx].push({ ...row, printer_id: printerIds[idx] });
  });
  return buckets;
}
