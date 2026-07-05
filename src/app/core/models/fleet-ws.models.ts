/**
 * WebSocket payloads для fleet management событий в room `employee:dashboard`.
 * Зеркалит emit-сайты в backend/src/services/fleet/{snmp-poller,cups-page-log-parser,canon-remote-ui-scraper,alerts-engine}.service.ts.
 */

export interface WsPrinterTelemetryUpdated {
  printerId: string;
  printerName: string;
  studioId: string | null;
  isOnline: boolean | null;
  state: string | null;
  supplies: unknown;
  trays: unknown;
  alerts: unknown;
  collectedAt: string;
}

export interface WsPrinterJobRecorded {
  jobId: string;
  printerId: string;
  printerName: string;
  studioId?: string | null;
  cupsJobId?: number;
  canonJobId?: string;
  pagesPrinted: number;
  duplex?: boolean;
  paperSize?: string;
  fileName: string;
  status?: 'completed' | 'failed';
  completedAt: string;
  source: 'cups' | 'canon_remote_ui' | 'rust_api' | 'windows_event' | 'bridge_agent';
  inserted: boolean;
}

export interface WsPrinterAlertRaised {
  alertId: string;
  printerId: string;
  printerName: string;
  studioId: string | null;
  alertType: string;
  severity: 'critical' | 'warn' | 'info';
  message: string | null;
  value: unknown;
  firstSeenAt: string;
}

export interface WsPrinterAlertResolved {
  alertId: string;
  printerId: string;
  printerName: string;
  studioId: string | null;
  alertType: string;
  resolveReason: string | null;
  resolvedAt: string;
}
