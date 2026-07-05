type PgCount = string | number | bigint | null;

export interface RestorationOrderWorkloadRow {
  readonly active_orders: PgCount;
  readonly completed_today: PgCount;
}

export interface RestorationRetouchTaskWorkloadRow {
  readonly active_retouch_tasks: PgCount;
}
