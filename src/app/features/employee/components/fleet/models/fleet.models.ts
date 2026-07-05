/**
 * DTO для Fleet Management UI. Зеркалит backend/src/routes/fleet.routes.ts.
 */

export type AlertSeverity = 'critical' | 'warn' | 'info';

export type PrinterType = 'laser_bw' | 'laser_color' | 'mfp' | 'inkjet' | 'thermal' | 'other';

export type PrintSource = 'rust_api' | 'cups' | 'canon_remote_ui' | 'windows_event' | 'bridge_agent';

export type JobStatus = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled';

/** GET /printers элемент ответа. */
export interface PrinterListItem {
  id: string;
  name: string;
  printer_type: PrinterType | string;
  studio_id: string | null;
  is_active: boolean;
  cups_printer_name: string | null;
  last_telemetry: LastTelemetrySummary | null;
  active_alerts_count: number;
  active_alerts_by_severity: Record<AlertSeverity, number>;
}

export interface LastTelemetrySummary {
  is_online: boolean | null;
  state: string | null;
  collected_at: string | null;
  supplies_summary: SupplySummary[];
  trays_summary: TraySummary[];
}

export interface SupplySummary {
  index: number | null;
  colorant: string | null;
  description: string | null;
  level_pct: number | null;
  type: string | null;
}

export interface TraySummary {
  index: number | null;
  name: string | null;
  current_level: number | null;
  max_capacity: number | null;
  pct: number | null;
}

/** GET /printers/:id ответ. */
export interface PrinterDetail {
  printer: PrinterBasic;
  telemetry: TelemetryFull | null;
  active_alerts: FleetAlert[];
  recent_replacements: SuppliesReplacement[];
  recent_jobs: PrintJob[];
}

export interface PrinterBasic {
  id: string;
  name: string;
  printer_type: string;
  studio_id: string | null;
  is_active: boolean;
  cups_printer_name: string | null;
}

export interface TelemetryFull {
  is_online: boolean | null;
  state: string | null;
  state_reasons: string[] | null;
  supplies: SupplyEntry[] | null;
  trays: TrayEntry[] | null;
  counters: TelemetryCounters | null;
  errors: unknown;
  model: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  firmware_version: string | null;
  collected_at: string;
}

export interface SupplyEntry {
  index?: number;
  description?: string;
  type?: string;
  level_pct?: number | null;
  max_capacity?: number;
  colorant?: string | null;
}

export interface TrayEntry {
  index?: number;
  name?: string;
  description?: string;
  current_level?: number | null;
  max_capacity?: number;
  media_name?: string | null;
  media_type?: string | null;
}

export interface TelemetryCounters {
  lifetime?: number | null;
  power_on?: number | null;
}

export interface FleetAlert {
  id: string;
  printer_id: string;
  studio_id: string | null;
  alert_type: string;
  severity: AlertSeverity;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolve_reason: string | null;
  last_value: unknown;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuppliesReplacement {
  id: string;
  printer_id: string;
  supply_type: string;
  supply_index: number | null;
  replaced_by: string | null;
  replaced_by_name: string | null;
  replaced_at: string;
  counter_at_replacement: number | null;
  note: string | null;
}

export interface PrintJob {
  id: string;
  created_at: string;
  completed_at: string | null;
  file_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  pages_printed: number | null;
  copies: number | null;
  status: JobStatus | string;
  print_source: PrintSource | string | null;
  external_job_id: string | null;
}

export type TelemetryInterval = 'raw' | 'hourly' | 'daily';

export interface TelemetryTimeseriesResponse {
  interval: TelemetryInterval;
  rows: unknown[];
}

export interface BurnRateResponse {
  pages_printed_7d: number;
  pages_per_day_avg: number;
  estimated_days_remaining_by_supply: BurnRateSupplyEstimate[];
}

export interface BurnRateSupplyEstimate {
  supply_type: string;
  colorant: string | null;
  level_pct: number | null;
  days_left: number | null;
}

/** POST /printers/:id/supplies/replace payload. */
export interface ReplaceSupplyRequest {
  supply_type: string;
  supply_index?: number;
  note?: string;
}

export interface ReplaceSupplyResponse {
  data: SuppliesReplacement;
  auto_resolved_alerts: number;
}

/** POST /printers/:id/telemetry/refresh ответ. */
export interface RefreshTelemetryResponse {
  triggered: true;
  snapshot: TelemetryFull | null;
  reason?: 'unreachable';
}

export interface JobsQueryParams {
  from?: string;
  to?: string;
  limit?: number;
  source?: PrintSource;
}

export interface AlertsQueryParams {
  active?: 'true' | 'false' | 'all';
  since?: string;
}
