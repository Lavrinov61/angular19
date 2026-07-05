/**
 * SNMP OID constants for Fleet Management printer polling.
 *
 * Based on RFC 3805 (Printer MIB v2) + RFC 1213 (system group) + RFC 2790 (host-resources).
 * Verified against Canon C3226i (see CANON_C3226I_DEV_CONTEXT.md) — these OIDs return
 * expected values for supplies, trays, markers and alerts on the real device.
 *
 * Conventions:
 *  - `*.0` suffix  = scalar (sysDescr, sysUpTime, …)
 *  - `*.1.<N>` suffix = first hrDevice (host-resources) — printers always report hrDeviceIndex=1
 *  - Base OIDs without trailing index are used as walk roots (subtree()).
 *
 * Printer MIB status codes we interpret:
 *  - hrDeviceStatus:   2=running, 3=warning, 4=testing, 5=down
 *  - hrPrinterStatus:  1=other, 2=unknown, 3=idle, 4=printing, 5=warmup
 *  - prtMarkerSuppliesType: 3=toner, 4=inkCartridge, 2=other, 1=...see RFC 3805
 *  - prtAlertSeverityLevel: 1=other, 3=critical, 4=warning, 5=warningBinaryChangeEvent
 */

export const STANDARD_OIDS = {
  // RFC 1213 — system group
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',

  // RFC 2790 — host-resources (device status for the printer device itself)
  hrDeviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1', // 2=running, 3=warning, 5=down
  hrPrinterStatus: '1.3.6.1.2.1.25.3.5.1.1.1', // 1=other,2=unknown,3=idle,4=printing,5=warmup

  // RFC 3805 — Printer MIB v2, prtMarkerSuppliesTable walk roots.
  // Walk returns rows keyed by (hrDeviceIndex, prtMarkerSuppliesIndex).
  prtMarkerSuppliesLevel: '1.3.6.1.2.1.43.11.1.1.9.1',
  prtMarkerSuppliesDescription: '1.3.6.1.2.1.43.11.1.1.6.1',
  prtMarkerSuppliesMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8.1',
  prtMarkerSuppliesType: '1.3.6.1.2.1.43.11.1.1.5.1', // 3=toner, 4=inkCartridge, 1=other, 9=drum
  prtMarkerSuppliesColorantIndex: '1.3.6.1.2.1.43.11.1.1.3.1',

  // prtMarkerColorantTable — map colorantIndex → colorant value (e.g. "cyan").
  prtMarkerColorantValue: '1.3.6.1.2.1.43.12.1.1.4.1',

  // prtInputTable — paper trays
  prtInputCurrentLevel: '1.3.6.1.2.1.43.8.2.1.10.1',
  prtInputMaxCapacity: '1.3.6.1.2.1.43.8.2.1.9.1',
  prtInputName: '1.3.6.1.2.1.43.8.2.1.13.1',
  prtInputDescription: '1.3.6.1.2.1.43.8.2.1.18.1',
  prtInputMediaName: '1.3.6.1.2.1.43.8.2.1.12.1',
  prtInputMediaType: '1.3.6.1.2.1.43.8.2.1.21.1',

  // prtMarker — life-time page counter
  prtMarkerLifeCount: '1.3.6.1.2.1.43.10.2.1.4.1.1',
  prtMarkerPowerOnCount: '1.3.6.1.2.1.43.10.2.1.5.1.1',

  // prtAlertTable — active alert list
  prtAlertSeverityLevel: '1.3.6.1.2.1.43.18.1.1.2',
  prtAlertTrainingLevel: '1.3.6.1.2.1.43.18.1.1.3',
  prtAlertGroup: '1.3.6.1.2.1.43.18.1.1.4',
  prtAlertDescription: '1.3.6.1.2.1.43.18.1.1.8',
  prtAlertCode: '1.3.6.1.2.1.43.18.1.1.7',
} as const;

export type StandardOidKey = keyof typeof STANDARD_OIDS;

// ── RFC-3805 enum maps (exported for consumers that want human-readable codes) ──

/** prtMarkerSuppliesType → our narrowed supply "kind". */
export const SUPPLY_TYPE_BY_CODE: Readonly<Record<number, 'toner' | 'ink' | 'drum' | 'other'>> = {
  1: 'other',
  2: 'other',
  3: 'toner',
  4: 'ink',
  6: 'other',
  9: 'drum',
  10: 'drum',
  11: 'drum',
  12: 'drum',
};

/** prtAlertSeverityLevel → our narrowed severity. */
export const ALERT_SEVERITY_BY_CODE: Readonly<
  Record<number, 'critical' | 'warning' | 'info'>
> = {
  1: 'info', // other
  3: 'critical',
  4: 'warning',
  5: 'warning', // warningBinaryChangeEvent
};

/** hrDeviceStatus → text state we write into printer_telemetry.state. */
export const DEVICE_STATE_BY_CODE: Readonly<Record<number, string>> = {
  1: 'unknown',
  2: 'running',
  3: 'warning',
  4: 'testing',
  5: 'down',
};
