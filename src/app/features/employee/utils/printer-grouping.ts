import { Printer } from '../services/print-api.service';

export type PrinterGroupMode = 'type' | 'studio';

export interface SmartPrinterGroup {
  key: string;
  label: string;
  icon: string;
  printers: Printer[];
  mode: PrinterGroupMode;
}

const TYPE_ORDER: Record<string, number> = { photo: 0, sublimation: 1, mfp: 2, document: 3 };

const TYPE_META: Record<string, { label: string; icon: string }> = {
  photo:        { label: 'Фото',        icon: 'photo_camera' },
  sublimation:  { label: 'Сублимация',  icon: 'palette' },
  mfp:          { label: 'МФУ',         icon: 'print' },
  document:     { label: 'Документы',   icon: 'description' },
};

function getEffectivePrinterType(p: Printer): string {
  if (
    p.capabilities?.sublimation ||
    p.capabilities?.media_types?.some(m => m.id === 'ds_transfer') ||
    p.name?.includes('SC-F')
  ) {
    return 'sublimation';
  }
  return p.printer_type;
}

export function groupPrintersSmart(printers: Printer[]): SmartPrinterGroup[] {
  if (!printers.length) return [];

  const studioIds = new Set(printers.map(p => p.studio_id ?? 'other'));
  const singleStudio = studioIds.size <= 1;

  if (singleStudio) {
    return groupByType(printers);
  }
  return groupByStudio(printers);
}

function groupByType(printers: Printer[]): SmartPrinterGroup[] {
  const groups = new Map<string, Printer[]>();
  for (const p of printers) {
    const type = getEffectivePrinterType(p);
    const arr = groups.get(type) ?? [];
    arr.push(p);
    groups.set(type, arr);
  }

  return Array.from(groups.entries())
    .sort((a, b) => (TYPE_ORDER[a[0]] ?? 99) - (TYPE_ORDER[b[0]] ?? 99))
    .map(([type, list]) => ({
      key: type,
      label: TYPE_META[type]?.label ?? type,
      icon: TYPE_META[type]?.icon ?? 'print',
      printers: list,
      mode: 'type' as const,
    }));
}

function groupByStudio(printers: Printer[]): SmartPrinterGroup[] {
  const groups = new Map<string, { name: string; printers: Printer[] }>();
  for (const p of printers) {
    const key = p.studio_id ?? 'other';
    if (!groups.has(key)) {
      groups.set(key, { name: p.studio_name ?? 'Принтеры', printers: [] });
    }
    groups.get(key)!.printers.push(p);
  }

  return Array.from(groups.entries()).map(([key, g]) => ({
    key,
    label: g.name,
    icon: 'location_on',
    printers: g.printers,
    mode: 'studio' as const,
  }));
}
