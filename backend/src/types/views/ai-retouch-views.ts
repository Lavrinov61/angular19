export interface AiRetouchAdminLogRow {
  id: string;
  status: string | null;
  operations: unknown;
  total_operations: number | null;
  cost_estimate_usd: string | null;
  actual_cost_usd: string | null;
  error: string | null;
  error_operation: number | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  source_photo_url: string;
  result_url: string | null;
  result_thumbnail_url: string | null;
  user_name: string | null;
  user_email: string | null;
  session_title: string | null;
  client_name: string | null;
}

export interface AiRetouchStatsRow {
  total_jobs: string;
  completed: string;
  failed: string;
  cancelled: string;
  total_cost_usd: string;
  avg_duration_sec: string;
}

export interface AiRetouchUserStatsRow {
  user_name: string | null;
  email: string | null;
  jobs: string;
  completed: string;
  cost_usd: string;
}

export interface AiRetouchOperationStatsRow {
  operation_type: string | null;
  count: string;
}
