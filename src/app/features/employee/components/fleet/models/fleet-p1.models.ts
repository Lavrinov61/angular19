/**
 * P1 DTO: dashboard summary + supply-type selector options.
 * Зеркалит backend GET /api/fleet/dashboard/summary (P1).
 */

export interface DashboardSummary {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  alerts: {
    critical: number;
    warn: number;
    info: number;
  };
  jobs_today: number;
  replacements_today: number;
}

export interface SupplyTypeOption {
  value: string;
  label: string;
  needsIndex: boolean;
}

export const SUPPLY_TYPE_OPTIONS: SupplyTypeOption[] = [
  { value: 'toner_k', label: 'Тонер чёрный (K)', needsIndex: false },
  { value: 'toner_c', label: 'Тонер голубой (C)', needsIndex: false },
  { value: 'toner_m', label: 'Тонер пурпурный (M)', needsIndex: false },
  { value: 'toner_y', label: 'Тонер жёлтый (Y)', needsIndex: false },
  { value: 'ink_k', label: 'Чернила чёрные (K)', needsIndex: false },
  { value: 'ink_c', label: 'Чернила голубые (C)', needsIndex: false },
  { value: 'ink_m', label: 'Чернила пурпурные (M)', needsIndex: false },
  { value: 'ink_y', label: 'Чернила жёлтые (Y)', needsIndex: false },
  { value: 'drum', label: 'Фотобарабан', needsIndex: false },
  { value: 'fuser', label: 'Фьюзер', needsIndex: false },
  { value: 'waste_toner', label: 'Сборник отработанного тонера', needsIndex: false },
  { value: 'paper_tray', label: 'Лоток с бумагой', needsIndex: true },
];
