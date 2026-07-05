use chrono::Utc;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::config::TelegramConfig;

/// Shared state for the scheduler background tasks.
pub struct SchedulerShared {
    pub db: PgPool,
    pub redis: redis::aio::MultiplexedConnection,
    pub telegram: Option<TelegramConfig>,
    pub http_client: reqwest::Client,
}

/// Spawn all scheduler background tasks.
pub fn spawn_schedulers(shared: Arc<SchedulerShared>) {
    let s = Arc::clone(&shared);
    tokio::spawn(async move { run_heartbeat_monitor(s).await });

    let s2 = Arc::clone(&shared);
    tokio::spawn(async move { run_rollout_auto_advance(s2).await });

    let s3 = Arc::clone(&shared);
    tokio::spawn(async move { run_stuck_job_detector(s3).await });

    let s4 = Arc::clone(&shared);
    tokio::spawn(async move { run_auto_redistribute(s4).await });

    let s5 = Arc::clone(&shared);
    tokio::spawn(async move { run_scheduled_dispatcher(s5).await });

    let s6 = Arc::clone(&shared);
    tokio::spawn(async move { run_preview_cleanup(s6).await });
}

// ── Heartbeat Monitor ────────────────────────────────────

#[derive(sqlx::FromRow)]
struct StaleAgent {
    id: Uuid,
    studio_id: Uuid,
    agent_type: String,
    name: String,
    stale_seconds: Option<f64>,
}

#[derive(sqlx::FromRow)]
struct HeartbeatRule {
    severity: String,
    threshold_seconds: i64,
    cooldown_minutes: i32,
    notification_channels: serde_json::Value,
}

/// Every 30s: check agents.last_heartbeat_at against alert_rules thresholds.
/// Creates infra_alerts, marks agents offline, notifies Telegram, publishes Redis.
async fn run_heartbeat_monitor(shared: Arc<SchedulerShared>) {
    // Initial delay — let MQTT connections establish
    tokio::time::sleep(Duration::from_secs(15)).await;
    tracing::info!("Heartbeat monitor scheduler started (30s interval)");

    loop {
        if let Err(e) = check_heartbeats(&shared).await {
            tracing::error!("Heartbeat monitor error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn check_heartbeats(
    shared: &SchedulerShared,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Load active heartbeat_timeout rules (sorted by threshold ascending)
    let rules = sqlx::query_as::<_, HeartbeatRule>(
        r#"SELECT
             severity,
             (condition_config->>'threshold_seconds')::bigint AS threshold_seconds,
             COALESCE(cooldown_minutes, 30) AS cooldown_minutes,
             notification_channels
           FROM alert_rules
           WHERE alert_type = 'heartbeat_timeout'
             AND is_active
           ORDER BY (condition_config->>'threshold_seconds')::bigint ASC"#,
    )
    .fetch_all(&shared.db)
    .await?;

    if rules.is_empty() {
        return Ok(());
    }

    // Process rules from most severe threshold down
    // Use the strictest (smallest) threshold to find all stale agents
    let min_threshold = rules
        .iter()
        .map(|r| r.threshold_seconds)
        .min()
        .unwrap_or(90);

    let stale_agents = sqlx::query_as::<_, StaleAgent>(
        r#"SELECT
             id, studio_id, agent_type, name,
             EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::float8 AS stale_seconds
           FROM agents
           WHERE is_active
             AND last_heartbeat_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) > $1"#,
    )
    .bind(min_threshold as f64)
    .fetch_all(&shared.db)
    .await?;

    if stale_agents.is_empty() {
        return Ok(());
    }

    for agent in &stale_agents {
        let stale_secs = agent.stale_seconds.unwrap_or(0.0) as i64;

        // Find the matching rule with the highest threshold that this agent exceeds
        // (i.e., most severe applicable rule)
        let matching_rule = rules
            .iter()
            .rev()
            .find(|r| stale_secs >= r.threshold_seconds);

        let Some(rule) = matching_rule else {
            continue;
        };

        // Check cooldown: skip if unresolved alert of same type exists within cooldown
        let recent_alert_exists: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1 FROM infra_alerts
                 WHERE agent_id = $1
                   AND alert_type = 'heartbeat_timeout'
                   AND resolved_at IS NULL
                   AND created_at > NOW() - make_interval(mins => $2)
               )"#,
        )
        .bind(agent.id)
        .bind(rule.cooldown_minutes)
        .fetch_one(&shared.db)
        .await?;

        if recent_alert_exists {
            continue;
        }

        // Mark agent offline
        sqlx::query(
            "UPDATE agents SET is_online = FALSE, last_disconnected_at = NOW() WHERE id = $1 AND is_online",
        )
        .bind(agent.id)
        .execute(&shared.db)
        .await?;

        let title = format!(
            "Агент «{}» не отвечает ({}с без heartbeat)",
            agent.name, stale_secs
        );

        let details = serde_json::json!({
            "agent_type": agent.agent_type,
            "stale_seconds": stale_secs,
            "threshold_seconds": rule.threshold_seconds,
        });

        // Insert alert
        let alert_id: i64 = sqlx::query_scalar(
            r#"INSERT INTO infra_alerts (studio_id, agent_id, alert_type, severity, title, details)
               VALUES ($1, $2, 'heartbeat_timeout', $3, $4, $5)
               RETURNING id"#,
        )
        .bind(agent.studio_id)
        .bind(agent.id)
        .bind(&rule.severity)
        .bind(&title)
        .bind(&details)
        .fetch_one(&shared.db)
        .await?;

        tracing::warn!(
            agent = %agent.name,
            severity = %rule.severity,
            stale_secs,
            alert_id,
            "Heartbeat timeout alert created"
        );

        // Redis → Socket.IO → CRM
        let redis_payload = serde_json::json!({
            "id": alert_id,
            "studio_id": agent.studio_id,
            "agent_id": agent.id,
            "agent_type": agent.agent_type,
            "alert_type": "heartbeat_timeout",
            "severity": rule.severity,
            "title": title,
        });

        let mut conn = shared.redis.clone();
        let _ = redis::cmd("PUBLISH")
            .arg("infra:alert")
            .arg(redis_payload.to_string())
            .query_async::<()>(&mut conn)
            .await;

        // Also publish heartbeat update (offline)
        let _ = redis::cmd("PUBLISH")
            .arg("infra:heartbeat")
            .arg(
                serde_json::json!({
                    "studio_id": agent.studio_id,
                    "agent_type": agent.agent_type,
                    "agent_id": agent.id,
                    "is_online": false,
                })
                .to_string(),
            )
            .query_async::<()>(&mut conn)
            .await;

        // Telegram for critical/warning with telegram channel
        let channels = rule
            .notification_channels
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
            .unwrap_or_default();

        if channels.contains(&"telegram") {
            let emoji = if rule.severity == "critical" {
                "🚨"
            } else {
                "⚠️"
            };
            let msg = format!(
                "{emoji} <b>HEARTBEAT TIMEOUT</b>\n{title}\nТочка: {}\nТип: {}",
                agent.studio_id, agent.agent_type
            );
            send_telegram(shared, &msg).await;
        }
    }

    Ok(())
}

// ── Rollout auto-advance ──

/// Every 60s: check rollout plans that are in_progress and due for next phase advancement.
async fn run_rollout_auto_advance(shared: Arc<SchedulerShared>) {
    tokio::time::sleep(Duration::from_secs(30)).await;
    tracing::info!("Rollout auto-advance scheduler started (60s interval)");

    loop {
        if let Err(e) = check_rollout_phases(&shared).await {
            tracing::error!("Rollout auto-advance error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

#[derive(sqlx::FromRow)]
struct RolloutDue {
    id: Uuid,
    current_phase: String,
    completed_agents: i32,
    failed_agents: i32,
    total_agents: i32,
}

async fn check_rollout_phases(
    shared: &SchedulerShared,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Find rollouts that are in_progress and past their next_phase_at
    let due_rollouts = sqlx::query_as::<_, RolloutDue>(
        r#"SELECT id, current_phase, completed_agents, failed_agents, total_agents
           FROM rollout_plans
           WHERE status = 'in_progress'
             AND next_phase_at IS NOT NULL
             AND next_phase_at <= NOW()"#,
    )
    .fetch_all(&shared.db)
    .await?;

    for rollout in &due_rollouts {
        // Check if all current batch updates have finished (no pending/downloading/installing)
        let in_flight: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM agent_update_commands
               WHERE rollout_id = $1 AND status IN ('pending', 'downloading', 'installing')"#,
        )
        .bind(rollout.id)
        .fetch_one(&shared.db)
        .await?;

        if in_flight > 0 {
            tracing::debug!(
                rollout = %rollout.id,
                in_flight,
                "Rollout has in-flight updates, deferring phase advance"
            );
            continue;
        }

        // Check for too many failures (>30% of batch = auto-pause)
        let batch_total = rollout.completed_agents + rollout.failed_agents;
        if batch_total > 0 && rollout.failed_agents as f64 / batch_total as f64 > 0.3 {
            sqlx::query("UPDATE rollout_plans SET status = 'paused' WHERE id = $1")
                .bind(rollout.id)
                .execute(&shared.db)
                .await?;

            tracing::warn!(
                rollout = %rollout.id,
                failed = rollout.failed_agents,
                total = batch_total,
                "Rollout auto-paused due to high failure rate (>30%)"
            );

            // Notify via Redis
            let mut conn = shared.redis.clone();
            let _ = redis::cmd("PUBLISH")
                .arg("infra:update_progress")
                .arg(
                    serde_json::json!({
                        "type": "rollout_paused",
                        "rollout_id": rollout.id.to_string(),
                        "reason": "high_failure_rate",
                        "failed": rollout.failed_agents,
                        "total": batch_total,
                    })
                    .to_string(),
                )
                .query_async::<()>(&mut conn)
                .await;

            continue;
        }

        // All current batch done → mark next_phase_at = NULL (manual or timed advance)
        // The actual phase advance is done via API call or we auto-advance here
        let remaining = rollout.total_agents - rollout.completed_agents - rollout.failed_agents;
        if remaining <= 0 {
            sqlx::query(
                "UPDATE rollout_plans SET status = 'completed', current_phase = 'done', completed_at = NOW() WHERE id = $1"
            )
            .bind(rollout.id)
            .execute(&shared.db)
            .await?;

            tracing::info!(rollout = %rollout.id, "Rollout completed (all agents updated)");

            let mut conn = shared.redis.clone();
            let _ = redis::cmd("PUBLISH")
                .arg("infra:update_progress")
                .arg(
                    serde_json::json!({
                        "type": "rollout_completed",
                        "rollout_id": rollout.id.to_string(),
                        "completed_agents": rollout.completed_agents,
                    })
                    .to_string(),
                )
                .query_async::<()>(&mut conn)
                .await;
        } else {
            // Clear next_phase_at — CRM operator can manually advance
            sqlx::query("UPDATE rollout_plans SET next_phase_at = NULL WHERE id = $1")
                .bind(rollout.id)
                .execute(&shared.db)
                .await?;

            tracing::info!(
                rollout = %rollout.id,
                phase = %rollout.current_phase,
                remaining,
                "Rollout phase wait complete, ready for manual advance"
            );

            let mut conn = shared.redis.clone();
            let _ = redis::cmd("PUBLISH")
                .arg("infra:update_progress")
                .arg(
                    serde_json::json!({
                        "type": "rollout_ready",
                        "rollout_id": rollout.id.to_string(),
                        "current_phase": rollout.current_phase,
                        "remaining_agents": remaining,
                    })
                    .to_string(),
                )
                .query_async::<()>(&mut conn)
                .await;
        }
    }

    Ok(())
}

// ── Stuck Job Detector ─────────────────────────────────

#[derive(sqlx::FromRow)]
struct StuckJob {
    id: Uuid,
    #[allow(dead_code)]
    printer_id: Uuid,
    status: String,
    studio_id: Option<Uuid>,
    created_at: chrono::DateTime<Utc>,
}

/// Every 2 min: detect print jobs stuck with differentiated timeouts per status.
/// - queued > 2 min → re-trigger NOTIFY
/// - sending > 3 min → reset to queued
/// - printing/applying_icc/rendering_layout > 15 min → mark failed
async fn run_stuck_job_detector(shared: Arc<SchedulerShared>) {
    tokio::time::sleep(Duration::from_secs(45)).await;
    tracing::info!("Stuck job detector started (2min interval)");

    loop {
        if let Err(e) = detect_stuck_jobs(&shared).await {
            tracing::error!("Stuck job detector error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(120)).await;
    }
}

async fn detect_stuck_jobs(
    shared: &SchedulerShared,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let stuck_jobs = sqlx::query_as::<_, StuckJob>(
        r#"SELECT id, printer_id, status, studio_id, created_at
           FROM print_jobs
           WHERE (
             (status = 'sending' AND created_at < NOW() - INTERVAL '3 minutes')
             OR (status = 'queued' AND created_at < NOW() - INTERVAL '2 minutes')
             OR (status IN ('printing', 'applying_icc', 'rendering_layout') AND created_at < NOW() - INTERVAL '15 minutes')
           )
           AND completed_at IS NULL"#,
    )
    .fetch_all(&shared.db)
    .await?;

    if stuck_jobs.is_empty() {
        return Ok(());
    }

    for job in &stuck_jobs {
        let age_minutes = (Utc::now() - job.created_at).num_minutes();

        match job.status.as_str() {
            // queued stuck → re-trigger NOTIFY so print agent picks it up
            "queued" => {
                let notify_payload = serde_json::json!({
                    "id": job.id,
                    "printer_id": job.printer_id,
                    "retry": true,
                });
                sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
                    .bind(notify_payload.to_string())
                    .execute(&shared.db)
                    .await?;

                tracing::warn!(
                    job_id = %job.id,
                    age_minutes,
                    "Stuck queued job — re-triggered NOTIFY"
                );
            }

            // sending stuck → reset to queued for re-delivery
            "sending" => {
                sqlx::query("UPDATE print_jobs SET status = 'queued' WHERE id = $1")
                    .bind(job.id)
                    .execute(&shared.db)
                    .await?;

                let notify_payload = serde_json::json!({
                    "id": job.id,
                    "printer_id": job.printer_id,
                    "retry": true,
                });
                sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
                    .bind(notify_payload.to_string())
                    .execute(&shared.db)
                    .await?;

                tracing::warn!(
                    job_id = %job.id,
                    age_minutes,
                    "Stuck sending job — reset to queued"
                );

                if let Some(studio_id) = job.studio_id {
                    let payload = serde_json::json!({
                        "job_id": job.id,
                        "status": "queued",
                        "studio_id": studio_id,
                        "reason": "sending_timeout_retry",
                    });
                    let mut conn = shared.redis.clone();
                    let _ = redis::cmd("PUBLISH")
                        .arg("print:job_update")
                        .arg(payload.to_string())
                        .query_async::<()>(&mut conn)
                        .await;
                }
            }

            // printing/applying_icc/rendering_layout stuck → mark failed
            _ => {
                let error_message = format!(
                    "Job timeout: status '{}' exceeded 15 minute limit (age: {}min)",
                    job.status, age_minutes
                );

                sqlx::query(
                    "UPDATE print_jobs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
                )
                .bind(job.id)
                .bind(&error_message)
                .execute(&shared.db)
                .await?;

                tracing::warn!(
                    job_id = %job.id,
                    status = %job.status,
                    age_minutes,
                    "Stuck job marked as failed"
                );

                if let Some(studio_id) = job.studio_id {
                    let payload = serde_json::json!({
                        "job_id": job.id,
                        "status": "failed",
                        "error": error_message,
                        "studio_id": studio_id,
                    });
                    let mut conn = shared.redis.clone();
                    let _ = redis::cmd("PUBLISH")
                        .arg("print:job_update")
                        .arg(payload.to_string())
                        .query_async::<()>(&mut conn)
                        .await;
                }
            }
        }
    }

    // Telegram alert for failed jobs only
    let failed_jobs: Vec<&StuckJob> = stuck_jobs
        .iter()
        .filter(|j| !matches!(j.status.as_str(), "queued" | "sending"))
        .collect();

    if !failed_jobs.is_empty() {
        let job_list: Vec<String> = failed_jobs
            .iter()
            .map(|j| {
                let age = (Utc::now() - j.created_at).num_minutes();
                format!("• {} (status: {}, age: {}min)", j.id, j.status, age)
            })
            .collect();

        let msg = format!(
            "⚠️ <b>STUCK PRINT JOBS</b>\n{} job(s) timed out:\n{}",
            failed_jobs.len(),
            job_list.join("\n")
        );
        send_telegram(shared, &msg).await;
    }

    Ok(())
}

// ── Auto-redistribute failed jobs ─────────────────────────

#[derive(sqlx::FromRow)]
struct FailedJobCandidate {
    id: Uuid,
    printer_id: Uuid,
    studio_id: Option<Uuid>,
    printer_type: String,
}

/// Every 2 min: find failed jobs (not yet reassigned, < 2h old) and auto-redistribute
/// to an alternative active printer of the same type in the same studio.
async fn run_auto_redistribute(shared: Arc<SchedulerShared>) {
    tokio::time::sleep(Duration::from_secs(60)).await;
    tracing::info!("Auto-redistribute scheduler started (2min interval)");

    loop {
        if let Err(e) = auto_redistribute_jobs(&shared).await {
            tracing::error!("Auto-redistribute error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(120)).await;
    }
}

async fn auto_redistribute_jobs(
    shared: &SchedulerShared,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let failed_jobs = sqlx::query_as::<_, FailedJobCandidate>(
        r#"SELECT j.id, j.printer_id, j.studio_id, p.printer_type
           FROM print_jobs j
           JOIN printers p ON j.printer_id = p.id
           WHERE j.status = 'failed'
             AND j.reassigned_from IS NULL
             AND j.created_at > NOW() - INTERVAL '2 hours'"#,
    )
    .fetch_all(&shared.db)
    .await?;

    if failed_jobs.is_empty() {
        return Ok(());
    }

    for job in &failed_jobs {
        let Some(studio_id) = job.studio_id else {
            continue;
        };

        // Find alternative active printer of the same type in the same studio
        let alt_printer: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT id FROM printers
               WHERE studio_id = $1
                 AND printer_type = $2
                 AND id != $3
                 AND is_active = true
               LIMIT 1"#,
        )
        .bind(studio_id)
        .bind(&job.printer_type)
        .bind(job.printer_id)
        .fetch_optional(&shared.db)
        .await?;

        let Some(new_printer_id) = alt_printer else {
            continue;
        };

        // Reassign the job
        sqlx::query(
            r#"UPDATE print_jobs SET
                 printer_id = $2,
                 status = 'queued',
                 error_message = NULL,
                 reassigned_from = $3,
                 reassign_reason = 'Auto-redistribute: failed job',
                 reassigned_at = NOW()
               WHERE id = $1"#,
        )
        .bind(job.id)
        .bind(new_printer_id)
        .bind(job.printer_id)
        .execute(&shared.db)
        .await?;

        // PG NOTIFY for print agent
        sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
            .bind(job.id.to_string())
            .execute(&shared.db)
            .await?;

        tracing::info!(
            job_id = %job.id,
            old_printer = %job.printer_id,
            new_printer = %new_printer_id,
            "Auto-redistributed job from printer {} to {}",
            job.printer_id,
            new_printer_id
        );

        // Redis PUBLISH for Socket.IO
        let payload = serde_json::json!({
            "job_id": job.id,
            "status": "queued",
            "printer_id": new_printer_id,
            "reassigned_from": job.printer_id,
            "studio_id": studio_id,
        });

        let mut conn = shared.redis.clone();
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    Ok(())
}

// ── Scheduled Job Dispatcher ──────────────────────────────

#[derive(sqlx::FromRow)]
struct ScheduledJobDue {
    id: Uuid,
    studio_id: Option<Uuid>,
}

/// Every 30s: dispatch scheduled jobs whose scheduled_at has arrived.
async fn run_scheduled_dispatcher(shared: Arc<SchedulerShared>) {
    tokio::time::sleep(Duration::from_secs(20)).await;
    tracing::info!("Scheduled job dispatcher started (30s interval)");

    loop {
        if let Err(e) = dispatch_scheduled_jobs(&shared).await {
            tracing::error!("Scheduled job dispatcher error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn dispatch_scheduled_jobs(
    shared: &SchedulerShared,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let due_jobs = sqlx::query_as::<_, ScheduledJobDue>(
        r#"UPDATE print_jobs
           SET status = 'queued', scheduled_at = NULL
           WHERE status = 'scheduled'
             AND scheduled_at <= NOW()
           RETURNING id, studio_id"#,
    )
    .fetch_all(&shared.db)
    .await?;

    if due_jobs.is_empty() {
        return Ok(());
    }

    for job in &due_jobs {
        let notify_payload = serde_json::json!({
            "id": job.id,
            "printer_id": Uuid::nil(),
            "studio_id": job.studio_id,
            "status": "queued",
        });
        sqlx::query("SELECT pg_notify('print_jobs_new', $1)")
            .bind(notify_payload.to_string())
            .execute(&shared.db)
            .await?;

        tracing::info!(job_id = %job.id, "Scheduled job dispatched to queue");
    }

    // Redis publish for CRM
    let mut conn = shared.redis.clone();
    for job in &due_jobs {
        let payload = serde_json::json!({
            "job_id": job.id,
            "status": "queued",
            "studio_id": job.studio_id,
            "reason": "scheduled_dispatch",
        });
        let _ = redis::cmd("PUBLISH")
            .arg("print:job_update")
            .arg(payload.to_string())
            .query_async::<()>(&mut conn)
            .await;
    }

    tracing::info!(count = due_jobs.len(), "Dispatched scheduled jobs");
    Ok(())
}

// ── Preview cleanup ─────────────────────────────────────

/// Every hour: scan Redis for orphaned print:preview:* keys without TTL and delete them.
/// Normally Redis TTL handles expiry, but this catches edge cases.
async fn run_preview_cleanup(shared: Arc<SchedulerShared>) {
    tokio::time::sleep(Duration::from_secs(120)).await;
    tracing::info!("Preview cleanup scheduler started (1h interval)");

    loop {
        if let Err(e) = cleanup_previews(&shared).await {
            tracing::error!("Preview cleanup error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

async fn cleanup_previews(
    shared: &SchedulerShared,
) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut conn = shared.redis.clone();

    // SCAN for print:preview:* keys
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg("print:preview:*")
        .query_async(&mut conn)
        .await?;

    if keys.is_empty() {
        return Ok(());
    }

    let mut cleaned = 0u32;
    for key in &keys {
        // Check TTL — if -1 (no expiry), set a 24h TTL as safety net
        let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut conn).await?;

        if ttl == -1 {
            // No TTL set — expire in 24h
            let _: () = redis::cmd("EXPIRE")
                .arg(key)
                .arg(86400)
                .query_async(&mut conn)
                .await?;
            cleaned += 1;
        }
    }

    if cleaned > 0 {
        tracing::info!(
            cleaned,
            total = keys.len(),
            "Preview cleanup: set TTL on orphaned keys"
        );
    }

    Ok(())
}

// ── Auto-resolve heartbeat alerts ──

/// Called from MQTT heartbeat handler when agent comes back online.
/// Resolves all open heartbeat_timeout alerts for this agent.
pub async fn auto_resolve_heartbeat_alerts(
    db: &PgPool,
    redis: &mut redis::aio::MultiplexedConnection,
    agent_id: Uuid,
    studio_id: Uuid,
    agent_type: &str,
) {
    let resolved = sqlx::query_scalar::<_, i64>(
        r#"WITH resolved AS (
             UPDATE infra_alerts
             SET resolved_at = NOW()
             WHERE agent_id = $1
               AND alert_type = 'heartbeat_timeout'
               AND resolved_at IS NULL
             RETURNING id
           )
           SELECT COUNT(*) FROM resolved"#,
    )
    .bind(agent_id)
    .fetch_one(db)
    .await
    .unwrap_or(0);

    if resolved > 0 {
        tracing::info!(agent = %agent_id, count = resolved, "Auto-resolved heartbeat timeout alerts");

        // Notify CRM about resolution
        let _ = redis::cmd("PUBLISH")
            .arg("infra:alert")
            .arg(
                serde_json::json!({
                    "studio_id": studio_id,
                    "agent_id": agent_id,
                    "agent_type": agent_type,
                    "alert_type": "heartbeat_timeout",
                    "action": "auto_resolved",
                    "resolved_count": resolved,
                })
                .to_string(),
            )
            .query_async::<()>(redis)
            .await;
    }
}

// ── Telegram helper ──

async fn send_telegram(shared: &SchedulerShared, message: &str) {
    let Some(ref tg) = shared.telegram else {
        return;
    };

    let url = format!("https://api.telegram.org/bot{}/sendMessage", tg.bot_token);

    let body = serde_json::json!({
        "chat_id": tg.alert_chat_id,
        "text": message,
        "parse_mode": "HTML",
    });

    match shared.http_client.post(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("Telegram alert sent");
        }
        Ok(resp) => {
            tracing::warn!(status = %resp.status(), "Telegram alert failed");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Telegram alert request failed");
        }
    }
}
