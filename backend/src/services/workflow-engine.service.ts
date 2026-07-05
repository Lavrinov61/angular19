/**
 * Workflow Engine Service — ФотоПульт CRM
 *
 * triggerEvent(type, data) — вызывается из роутов при событиях
 * Scheduler: каждые 30s проверяет pending runs → выполняет действия
 *
 * Triggers: order_paid | chat_created | chat_closed | booking_completed | manual
 * Actions:  create_task | notify_team | send_email | add_note | set_tag
 */

import db from '../database/db.js';

import { createLogger } from '../utils/logger.js';
// ── Types ────────────────────────────────────────────────────

const logger = createLogger('workflow-engine.service');
export type TriggerType =
  | 'order_paid'
  | 'chat_created'
  | 'chat_closed'
  | 'booking_completed'
  | 'manual';

export type ActionType =
  | 'create_task'
  | 'notify_team'
  | 'send_email'
  | 'add_note'
  | 'set_tag';

export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with';

export interface WorkflowCondition {
  field: string;
  op: ConditionOp;
  value: string | number | boolean;
}

export interface WorkflowAction {
  type: ActionType;
  params: Record<string, unknown>;
  delay_seconds: number;
}

export interface WorkflowRow {
  id: number;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface TriggerPayload {
  entity_type?: string;
  entity_id?: number | string;
  client_phone?: string;
  amount?: number;
  order_id?: number;
  channel?: string;
  session_id?: string;
  operator_id?: number;
  booking_id?: number;
  [key: string]: unknown;
}

// ── Condition Evaluator ──────────────────────────────────────

function evaluateCondition(condition: WorkflowCondition, payload: TriggerPayload): boolean {
  const raw = payload[condition.field];
  const actual = raw !== undefined ? raw : null;
  const expected = condition.value;

  switch (condition.op) {
    case 'eq':          return String(actual) === String(expected);
    case 'neq':         return String(actual) !== String(expected);
    case 'gt':          return Number(actual) > Number(expected);
    case 'gte':         return Number(actual) >= Number(expected);
    case 'lt':          return Number(actual) < Number(expected);
    case 'lte':         return Number(actual) <= Number(expected);
    case 'contains':    return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'starts_with': return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    default:            return false;
  }
}

function evaluateConditions(conditions: WorkflowCondition[], payload: TriggerPayload): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, payload));
}

// ── Action Executor ──────────────────────────────────────────

async function executeAction(
  action: WorkflowAction,
  payload: TriggerPayload,
  workflowId: number,
): Promise<{ type: string; success: boolean; result?: unknown; error?: string }> {
  try {
    switch (action.type) {

      case 'create_task': {
        const rawTitle = String(action.params['title'] || 'Задача из workflow');
        const priority = String(action.params['priority'] || 'medium');
        const assignedTo = action.params['assigned_to'] ? Number(action.params['assigned_to']) : null;

        const resolvedTitle = rawTitle
          .replace('{{client_phone}}', String(payload.client_phone || ''))
          .replace('{{amount}}', String(payload.amount || ''))
          .replace('{{order_id}}', String(payload.order_id || ''));

        const description = [
          `Создано workflow #${workflowId}`,
          payload.client_phone ? `Клиент: ${payload.client_phone}` : '',
          payload.amount ? `Сумма: ${payload.amount} ₽` : '',
        ].filter(Boolean).join('\n');

        const rows = await db.query<{ id: number }>(
          `INSERT INTO work_tasks (title, description, priority, assigned_to, status, source, created_at)
           VALUES ($1, $2, $3, $4, 'open', 'workflow', NOW())
           RETURNING id`,
          [resolvedTitle, description, priority, assignedTo],
        );

        return { type: 'create_task', success: true, result: { task_id: rows[0]?.id } };
      }

      case 'notify_team': {
        const rawMessage = String(action.params['message'] || 'Уведомление от workflow');
        const resolvedMessage = rawMessage
          .replace('{{client_phone}}', String(payload.client_phone || ''))
          .replace('{{amount}}', String(payload.amount || ''));

        // Логируем уведомление — WebSocket интеграция через NotificationService при необходимости
        logger.info(`[Workflow #${workflowId}] notify_team: ${resolvedMessage}`);

        return { type: 'notify_team', success: true, result: { message: resolvedMessage } };
      }

      case 'add_note': {
        const content = String(action.params['content'] || 'Заметка от workflow');
        const entityType = String(action.params['entity_type'] || payload.entity_type || 'general');
        const entityId = payload.entity_id ? String(payload.entity_id) : null;

        if (entityId) {
          await db.query(
            `INSERT INTO crm_notes (entity_type, entity_id, content, author_id, created_at)
             VALUES ($1, $2, $3, NULL, NOW())`,
            [entityType, entityId, `[Workflow #${workflowId}] ${content}`],
          );
        }

        return { type: 'add_note', success: true, result: { entity_type: entityType, entity_id: entityId } };
      }

      case 'set_tag': {
        const tagName = String(action.params['tag'] || '');
        if (tagName && payload.session_id) {
          const tagRows = await db.query<{ id: number }>(
            `INSERT INTO chat_tags (name, created_at) VALUES ($1, NOW())
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [tagName],
          );
          if (tagRows[0]) {
            await db.query(
              `INSERT INTO visitor_chat_session_tags (session_id, tag_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [payload.session_id, tagRows[0].id],
            );
          }
        }
        return { type: 'set_tag', success: true, result: { tag: tagName } };
      }

      case 'send_email': {
        const to = String(action.params['to'] || '');
        const subject = String(action.params['subject'] || 'Уведомление');
        logger.info(`[Workflow #${workflowId}] send_email → ${to}: ${subject}`);
        return { type: 'send_email', success: true, result: { to, subject, note: 'queued' } };
      }

      default:
        return { type: String(action.type), success: false, error: 'Unknown action type' };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`[WorkflowEngine] Action ${action.type} failed:`, { detail: error });
    return { type: action.type, success: false, error };
  }
}

// ── Main Trigger Function ────────────────────────────────────

export async function triggerEvent(type: TriggerType, payload: TriggerPayload): Promise<void> {
  try {
    const workflows = await db.query<WorkflowRow>(
      `SELECT * FROM workflows WHERE trigger_type = $1 AND is_active = true`,
      [type],
    );

    if (workflows.length === 0) return;

    for (const workflow of workflows) {
      const conditions: WorkflowCondition[] = Array.isArray(workflow.conditions) ? workflow.conditions : [];
      if (!evaluateConditions(conditions, payload)) continue;

      const actions: WorkflowAction[] = Array.isArray(workflow.actions) ? workflow.actions : [];
      if (actions.length === 0) continue;

      const runRows = await db.query<{ id: number }>(
        `INSERT INTO workflow_runs (workflow_id, trigger_data, status, scheduled_at)
         VALUES ($1, $2, 'pending', NOW())
         RETURNING id`,
        [workflow.id, JSON.stringify(payload)],
      );
      const runId = runRows[0].id;

      await db.query(
        `UPDATE workflows SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1`,
        [workflow.id],
      );

      // Если нет отложенных действий — выполняем немедленно
      const hasDelayed = actions.some(a => a.delay_seconds > 0);
      if (!hasDelayed) {
        void executeWorkflowRun(runId, workflow.id, actions, payload);
      }
    }
  } catch (err) {
    logger.error('[WorkflowEngine] triggerEvent error:', { error: String(err) });
  }
}

export async function executeWorkflowRun(
  runId: number,
  workflowId: number,
  actions: WorkflowAction[],
  payload: TriggerPayload,
): Promise<void> {
  try {
    await db.query(
      `UPDATE workflow_runs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [runId],
    );

    const results: unknown[] = [];
    let hasError = false;

    for (const action of actions) {
      if (action.delay_seconds > 0) {
        setTimeout(async () => {
          await executeAction(action, payload, workflowId);
        }, action.delay_seconds * 1000);
        results.push({ type: action.type, success: true, result: { scheduled: true, delay_seconds: action.delay_seconds } });
      } else {
        const result = await executeAction(action, payload, workflowId);
        results.push(result);
        if (!result.success) hasError = true;
      }
    }

    await db.query(
      `UPDATE workflow_runs SET status = $1, result = $2, completed_at = NOW() WHERE id = $3`,
      [hasError ? 'failed' : 'completed', JSON.stringify(results), runId],
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`[WorkflowEngine] Run #${runId} failed:`, { detail: error });
    await db.query(
      `UPDATE workflow_runs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [error, runId],
    ).catch(() => {});
  }
}

// ── Scheduler ────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function processScheduledRuns(): Promise<void> {
  try {
    const pendingRuns = await db.query<{
      id: number;
      workflow_id: number;
      trigger_data: TriggerPayload;
      actions: WorkflowAction[];
    }>(
      `SELECT wr.id, wr.workflow_id, wr.trigger_data, w.actions
       FROM workflow_runs wr
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE wr.status = 'pending'
         AND wr.scheduled_at <= NOW()
         AND w.is_active = true
       LIMIT 10`,
    );

    for (const run of pendingRuns) {
      const actions: WorkflowAction[] = Array.isArray(run.actions) ? run.actions : [];
      const payload: TriggerPayload = (run.trigger_data as TriggerPayload) || {};
      void executeWorkflowRun(run.id, run.workflow_id, actions, payload);
    }
  } catch (err) {
    logger.error('[WorkflowEngine] Scheduler error:', { error: String(err) });
  }
}

export function startWorkflowScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(processScheduledRuns, 30_000);
  logger.info('[WorkflowEngine] Scheduler started (30s interval)');
}

export function stopWorkflowScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
