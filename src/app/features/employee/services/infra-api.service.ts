import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// ─── TYPES ────────────────────────────────────────────────

export type AgentType = 'print' | 'pos' | 'vision' | 'monitor' | 'guard';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type UpdateStatus = 'pending' | 'downloading' | 'installing' | 'completed' | 'failed' | 'rolled_back';

export interface Agent {
  id: string;
  studio_id: string;
  agent_type: AgentType;
  name: string;
  hostname: string | null;
  current_version: string | null;
  target_version: string | null;
  mqtt_username: string;
  is_online: boolean;
  last_heartbeat_at: string | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  os_version: string | null;
  os_arch: string | null;
  config_version: number;
  desired_config: Record<string, unknown>;
  applied_config: Record<string, unknown>;
  uptime_seconds: number | null;
  last_restart_reason: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  studio_name: string | null;
  health_status?: 'healthy' | 'degraded' | 'unhealthy';
  circuit_breakers?: Record<string, CircuitBreakerState>;
}

export interface CreateAgentDto {
  studio_id: string;
  agent_type: AgentType;
  name: string;
  hostname?: string;
}

export interface UpdateAgentDto {
  name?: string;
  hostname?: string;
  target_version?: string;
  is_active?: boolean;
  desired_config?: Record<string, unknown>;
}

export interface AgentListFilters {
  studio_id?: string;
  agent_type?: AgentType;
  is_online?: boolean;
}

export interface AgentRelease {
  id: string;
  agent_type: AgentType;
  version: string;
  platform: string;
  artifact_url: string;
  artifact_hash_sha256: string;
  artifact_size_bytes: number;
  release_notes: string | null;
  is_stable: boolean;
  min_os_version: string | null;
  released_by: string | null;
  released_at: string;
  promoted_at: string | null;
  download_count: number | null;
}

export interface CreateReleaseDto {
  agent_type: AgentType;
  version: string;
  platform: string;
  artifact_url: string;
  artifact_hash_sha256: string;
  artifact_size_bytes: number;
  release_notes?: string;
  is_stable?: boolean;
  min_os_version?: string;
}

export interface UpdateCommand {
  id: string;
  agent_id: string;
  release_id: string;
  status: UpdateStatus;
  error_message: string | null;
  previous_version: string | null;
  rollback_url: string | null;
  initiated_by: string | null;
  initiated_at: string;
  started_at: string | null;
  completed_at: string | null;
  progress_percent: number | null;
  rollout_id: string | null;
  scheduled_at: string | null;
}

export interface InfraAlert {
  id: number;
  studio_id: string;
  agent_id: string | null;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  details: Record<string, unknown>;
  is_acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  studio_name: string | null;
  agent_name: string | null;
}

export interface AlertListFilters {
  studio_id?: string;
  severity?: AlertSeverity;
  unresolved?: boolean;
  limit?: number;
}

export interface AlertRule {
  id: string;
  agent_type: AgentType | null;
  alert_type: string;
  severity: AlertSeverity;
  condition_config: Record<string, unknown>;
  notification_channels: string[];
  cooldown_minutes: number | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateAlertRuleDto {
  agent_type?: AgentType;
  alert_type: string;
  severity: AlertSeverity;
  condition_config: Record<string, unknown>;
  notification_channels?: string[];
  cooldown_minutes?: number;
}

export interface UpdateAlertRuleDto {
  severity?: AlertSeverity;
  condition_config?: Record<string, unknown>;
  notification_channels?: string[];
  cooldown_minutes?: number;
  is_active?: boolean;
}

export interface FleetStatus {
  agent_type: AgentType;
  current_version: string | null;
  total: number;
  online: number;
  offline: number;
  pending_update: number;
}

export interface FleetOverview {
  fleet: FleetStatus[];
  totals: {
    total_agents: number;
    online_agents: number;
    total_locations: number;
  };
}

export interface FleetHealth {
  critical_alerts: number;
  stale_agents: number;
  offline_agents: number;
  status: 'healthy' | 'degraded' | 'critical';
}

export interface InfraLocation {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  region: string | null;
  city: string | null;
  is_infra_enabled: boolean | null;
  agent_count: number;
  online_count: number;
  alert_count: number;
}

export interface LocationDetail {
  location: InfraLocation;
  agents: Agent[];
  alerts: InfraAlert[];
}

export interface RolloutPlan {
  id: string;
  release_id: string;
  strategy: 'canary' | 'batch' | 'fleet';
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';
  target_agent_type: AgentType;
  target_platform: string | null;
  total_agents: number;
  completed_agents: number;
  failed_agents: number;
  canary_count: number;
  canary_wait_minutes: number;
  batch_percent: number;
  batch_wait_minutes: number;
  current_phase: 'canary' | 'batch' | 'fleet' | 'done';
  phase_started_at: string | null;
  next_phase_at: string | null;
  initiated_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StartRolloutDto {
  strategy?: 'canary' | 'batch' | 'fleet';
  canary_count?: number;
  canary_wait_minutes?: number;
  batch_percent?: number;
  batch_wait_minutes?: number;
}

export interface SystemTelemetry {
  id: number;
  agent_id: string;
  studio_id: string;
  cpu_percent: number | null;
  memory_used_mb: number | null;
  memory_total_mb: number | null;
  disk_used_gb: number | null;
  disk_total_gb: number | null;
  network_rx_bytes_sec: number | null;
  network_tx_bytes_sec: number | null;

  // Disk I/O
  disk_iops_read?: number;
  disk_iops_write?: number;
  disk_latency_ms?: number;
  disk_queue_depth?: number;
  disk_smart_status?: 'healthy' | 'warning' | 'critical';

  // Network extended
  network_interfaces?: NetworkInterface[];
  network_latency_gateway_ms?: number;
  network_latency_dns_ms?: number;
  network_latency_mqtt_ms?: number;
  network_latency_internet_ms?: number;

  peripherals: unknown[];
  agent_statuses: Record<string, string>;
  collected_at: string;
}

export interface NetworkInterface {
  name: string;
  ip: string;
  speed_mbps: number;
  is_up: boolean;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

// ─── SERVICE ──────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class InfraApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/infra';

  // ── Agents ──

  getAgents(filters: AgentListFilters = {}): Observable<Agent[]> {
    const params: Record<string, string> = {};
    if (filters.studio_id) params['studio_id'] = filters.studio_id;
    if (filters.agent_type) params['agent_type'] = filters.agent_type;
    if (filters.is_online !== undefined) params['is_online'] = String(filters.is_online);
    return this.http.get<{ success: boolean; agents: Agent[] }>(
      `${this.base}/agents`, { params }
    ).pipe(map(r => r.agents));
  }

  getAgent(id: string): Observable<Agent> {
    return this.http.get<{ success: boolean; agent: Agent }>(
      `${this.base}/agents/${id}`
    ).pipe(map(r => r.agent));
  }

  createAgent(data: CreateAgentDto): Observable<{ agent: Agent; mqtt_credentials: { username: string; password: string } }> {
    return this.http.post<{ success: boolean; agent: Agent; mqtt_credentials: { username: string; password: string } }>(
      `${this.base}/agents`, data
    ).pipe(map(r => ({ agent: r.agent, mqtt_credentials: r.mqtt_credentials })));
  }

  updateAgent(id: string, data: UpdateAgentDto): Observable<Agent> {
    return this.http.put<{ success: boolean; agent: Agent }>(
      `${this.base}/agents/${id}`, data
    ).pipe(map(r => r.agent));
  }

  deleteAgent(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/agents/${id}`);
  }

  restartAgent(id: string): Observable<{ message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.base}/agents/${id}/restart`, {}
    ).pipe(map(r => ({ message: r.message })));
  }

  pushConfig(id: string, config: Record<string, unknown>, restartRequired = false): Observable<{ config_version: number }> {
    return this.http.post<{ success: boolean; config_version: number }>(
      `${this.base}/agents/${id}/config`, { config, restart_required: restartRequired }
    ).pipe(map(r => ({ config_version: r.config_version })));
  }

  triggerUpdate(agentId: string, releaseId: string, force = false): Observable<UpdateCommand> {
    return this.http.post<{ success: boolean; update_command: UpdateCommand }>(
      `${this.base}/agents/${agentId}/update`, { release_id: releaseId, force }
    ).pipe(map(r => r.update_command));
  }

  // ── Fleet ──

  getFleetOverview(): Observable<FleetOverview> {
    return this.http.get<{ success: boolean; fleet: FleetStatus[]; totals: FleetOverview['totals'] }>(
      `${this.base}/fleet/overview`
    ).pipe(map(r => ({ fleet: r.fleet, totals: r.totals })));
  }

  getFleetHealth(): Observable<FleetHealth> {
    return this.http.get<{ success: boolean; health: FleetHealth }>(
      `${this.base}/fleet/health`
    ).pipe(map(r => r.health));
  }

  getFleetVersions(): Observable<FleetStatus[]> {
    return this.http.get<{ success: boolean; versions: FleetStatus[] }>(
      `${this.base}/fleet/versions`
    ).pipe(map(r => r.versions));
  }

  // ── Releases ──

  getReleases(filters: { agent_type?: string; platform?: string; is_stable?: boolean } = {}): Observable<AgentRelease[]> {
    const params: Record<string, string> = {};
    if (filters.agent_type) params['agent_type'] = filters.agent_type;
    if (filters.platform) params['platform'] = filters.platform;
    if (filters.is_stable !== undefined) params['is_stable'] = String(filters.is_stable);
    return this.http.get<{ success: boolean; releases: AgentRelease[] }>(
      `${this.base}/releases`, { params }
    ).pipe(map(r => r.releases));
  }

  createRelease(data: CreateReleaseDto): Observable<AgentRelease> {
    return this.http.post<{ success: boolean; release: AgentRelease }>(
      `${this.base}/releases`, data
    ).pipe(map(r => r.release));
  }

  getUpdates(): Observable<UpdateCommand[]> {
    return this.http.get<{ success: boolean; updates: UpdateCommand[] }>(
      `${this.base}/updates`
    ).pipe(map(r => r.updates));
  }

  // ── Rollouts ──

  getRollouts(status?: string): Observable<RolloutPlan[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    return this.http.get<{ success: boolean; rollouts: RolloutPlan[] }>(
      `${this.base}/rollouts`, { params }
    ).pipe(map(r => r.rollouts));
  }

  getRollout(id: string): Observable<{ rollout: RolloutPlan; updates: UpdateCommand[] }> {
    return this.http.get<{ success: boolean; rollout: RolloutPlan; updates: UpdateCommand[] }>(
      `${this.base}/rollouts/${id}`
    ).pipe(map(r => ({ rollout: r.rollout, updates: r.updates })));
  }

  startRollout(releaseId: string, dto: StartRolloutDto = {}): Observable<RolloutPlan> {
    return this.http.post<{ success: boolean; rollout: RolloutPlan }>(
      `${this.base}/releases/${releaseId}/rollout`, dto
    ).pipe(map(r => r.rollout));
  }

  advanceRollout(rolloutId: string): Observable<RolloutPlan> {
    return this.http.post<{ success: boolean; rollout: RolloutPlan }>(
      `${this.base}/rollouts/${rolloutId}/advance`, {}
    ).pipe(map(r => r.rollout));
  }

  pauseRollout(rolloutId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/rollouts/${rolloutId}/pause`, {});
  }

  cancelRollout(rolloutId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/rollouts/${rolloutId}/cancel`, {});
  }

  // ── Fleet Update ──

  fleetUpdate(releaseId: string, force = false): Observable<{ agents_updated: number; update_commands: UpdateCommand[] }> {
    return this.http.post<{ success: boolean; agents_updated: number; update_commands: UpdateCommand[] }>(
      `${this.base}/fleet/update`, { release_id: releaseId, force }
    ).pipe(map(r => ({ agents_updated: r.agents_updated, update_commands: r.update_commands })));
  }

  // ── Rollback ──

  rollbackUpdate(updateId: string): Observable<{ rollback_command: UpdateCommand }> {
    return this.http.post<{ success: boolean; rollback_command: UpdateCommand; original_command_status: string }>(
      `${this.base}/updates/${updateId}/rollback`, {}
    ).pipe(map(r => ({ rollback_command: r.rollback_command })));
  }

  // ── Promote ──

  promoteRelease(releaseId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/releases/${releaseId}/promote`, {});
  }

  // ── Alerts ──

  getAlerts(filters: AlertListFilters = {}): Observable<InfraAlert[]> {
    const params: Record<string, string> = {};
    if (filters.studio_id) params['studio_id'] = filters.studio_id;
    if (filters.severity) params['severity'] = filters.severity;
    if (filters.unresolved !== undefined) params['unresolved'] = String(filters.unresolved);
    if (filters.limit) params['limit'] = String(filters.limit);
    return this.http.get<{ success: boolean; alerts: InfraAlert[] }>(
      `${this.base}/alerts`, { params }
    ).pipe(map(r => r.alerts));
  }

  acknowledgeAlert(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/alerts/${id}/acknowledge`, {});
  }

  resolveAlert(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/alerts/${id}/resolve`, {});
  }

  // ── Alert Rules ──

  getAlertRules(): Observable<AlertRule[]> {
    return this.http.get<{ success: boolean; rules: AlertRule[] }>(
      `${this.base}/alert-rules`
    ).pipe(map(r => r.rules));
  }

  createAlertRule(data: CreateAlertRuleDto): Observable<AlertRule> {
    return this.http.post<{ success: boolean; rule: AlertRule }>(
      `${this.base}/alert-rules`, data
    ).pipe(map(r => r.rule));
  }

  updateAlertRule(id: string, data: UpdateAlertRuleDto): Observable<AlertRule> {
    return this.http.put<{ success: boolean; rule: AlertRule }>(
      `${this.base}/alert-rules/${id}`, data
    ).pipe(map(r => r.rule));
  }

  // ── System Telemetry ──

  getSystemTelemetry(agentId: string): Observable<SystemTelemetry | null> {
    return this.http.get<{ success: boolean; telemetry: SystemTelemetry | null }>(
      `${this.base}/system-telemetry/${agentId}`
    ).pipe(map(r => r.telemetry));
  }

  getSystemTelemetryHistory(agentId: string, hours = 24, limit = 200): Observable<SystemTelemetry[]> {
    return this.http.get<{ success: boolean; history: SystemTelemetry[] }>(
      `${this.base}/system-telemetry/${agentId}/history`, { params: { hours: String(hours), limit: String(limit) } }
    ).pipe(map(r => r.history));
  }

  // ── Locations ──

  getLocations(): Observable<InfraLocation[]> {
    return this.http.get<{ success: boolean; locations: InfraLocation[] }>(
      `${this.base}/locations`
    ).pipe(map(r => r.locations));
  }

  getLocation(id: string): Observable<LocationDetail> {
    return this.http.get<{ success: boolean; location: InfraLocation; agents: Agent[]; alerts: InfraAlert[] }>(
      `${this.base}/locations/${id}`
    ).pipe(map(r => ({ location: r.location, agents: r.agents, alerts: r.alerts })));
  }
}
