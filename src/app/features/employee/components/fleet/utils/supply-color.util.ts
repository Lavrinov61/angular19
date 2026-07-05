/**
 * Pure helpers: маппинг level_pct и colorant в визуальные атрибуты.
 */

export function supplyLevelClass(pct: number | null | undefined): 'ok' | 'low' | 'critical' | 'unknown' {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return 'unknown';
  if (pct <= 15) return 'critical';
  if (pct <= 30) return 'low';
  return 'ok';
}

export function supplyLevelColor(pct: number | null | undefined): string {
  switch (supplyLevelClass(pct)) {
    case 'ok':       return '#22c55e';
    case 'low':      return '#f59e0b';
    case 'critical': return '#ef4444';
    default:         return '#9ca3af';
  }
}

const COLORANT_HEX: Record<string, string> = {
  k: '#111',
  c: '#00BCD4',
  m: '#E91E63',
  y: '#FFC107',
};

export function colorantToHex(colorant: string | null): string {
  if (!colorant) return '#6b7280';
  return COLORANT_HEX[colorant.trim().toLowerCase()] ?? '#6b7280';
}
