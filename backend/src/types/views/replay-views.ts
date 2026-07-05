import type BehaviorEvents from '../generated/public/BehaviorEvents.js';
import type ReplaySessions from '../generated/public/ReplaySessions.js';

export type ReplaySessionCreateRow = Pick<ReplaySessions, 'id'>;

export type ReplaySessionEndRow = Pick<
  ReplaySessions,
  'visitor_id' | 'fingerprint_visitor_id' | 'landing_page' | 'total_pages' | 'duration_seconds' | 'started_at'
>;

export interface ReplayStatsRow {
  total_sessions: number;
  avg_duration: number;
  error_sessions: number;
  desktop_count: number;
  mobile_count: number;
  tablet_count: number;
  unique_visitors: number;
}

export type ReplaySessionListRow = Pick<
  ReplaySessions,
  | 'id'
  | 'visitor_id'
  | 'user_id'
  | 'landing_page'
  | 'device_type'
  | 'started_at'
  | 'ended_at'
  | 'duration_seconds'
  | 'total_pages'
  | 'total_clicks'
  | 'chunk_count'
  | 'has_error'
  | 'is_complete'
> & {
  user_name: string | null;
  user_phone: string | null;
};

export interface ReplayHeatmapClickRow {
  nx: number;
  ny: number;
  count: number;
  page_path: BehaviorEvents['page_path'];
}

export interface ReplayHeatmapPageRow {
  page_path: NonNullable<BehaviorEvents['page_path']>;
  total_clicks: number;
}

export interface ReplayFunnelStepRow {
  step: string;
  visitors: number;
  sessions: number;
}

export interface ReplayTopPageRow {
  page_path: NonNullable<BehaviorEvents['page_path']>;
  visits: number;
  unique_sessions: number;
  unique_visitors: number;
  avg_time_ms: number;
  bounce_count: number;
}
