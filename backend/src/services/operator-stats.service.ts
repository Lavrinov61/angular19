/**
 * operator-stats.service.ts — Operator performance statistics
 *
 * v3: Uses conversations + messages tables (omnichannel v2 schema).
 * CTE-based queries eliminate correlated subqueries (O(n) → O(1)).
 */
import db from '../database/db.js';

export interface OperatorStats {
  operator_id: string;
  operator_name: string;
  chats_handled: number;
  messages_sent: number;
  avg_first_response_sec: number | null;
  avg_resolution_sec: number | null;
  active_sessions: number;
  avg_csat: number | null;
}

interface SummaryRow {
  total_chats: string;
  total_messages: string;
  avg_first_response: string | null;
  avg_resolution: string | null;
}

interface OperatorRow {
  operator_id: string;
  operator_name: string;
  chats_handled: string;
  messages_sent: string;
  avg_first_response: string | null;
  avg_resolution: string | null;
  active_sessions: string;
  avg_csat: string | null;
}

function periodCondition(period: string): string {
  switch (period) {
    case 'today': return "c.created_at >= CURRENT_DATE";
    case 'week': return "c.created_at >= CURRENT_DATE - INTERVAL '7 days'";
    case 'month': return "c.created_at >= CURRENT_DATE - INTERVAL '30 days'";
    default: return "c.created_at >= CURRENT_DATE";
  }
}

export async function getOperatorStatsSummary(period: string): Promise<{
  totalChats: number;
  totalMessages: number;
  avgFirstResponseSec: number | null;
  avgResolutionSec: number | null;
}> {
  const cond = periodCondition(period);
  const rows = await db.query<SummaryRow>(
    `SELECT
       COUNT(DISTINCT c.id) AS total_chats,
       COALESCE(SUM(c.message_count), 0) AS total_messages,
       EXTRACT(EPOCH FROM AVG(c.first_response_at - c.created_at)) AS avg_first_response,
       EXTRACT(EPOCH FROM AVG(c.resolved_at - c.created_at)) AS avg_resolution
     FROM conversations c
     WHERE ${cond}
       AND c.assigned_operator_id IS NOT NULL`
  );

  const r = rows[0];
  return {
    totalChats: parseInt(r?.total_chats || '0', 10),
    totalMessages: parseInt(r?.total_messages || '0', 10),
    avgFirstResponseSec: r?.avg_first_response ? parseFloat(r.avg_first_response) : null,
    avgResolutionSec: r?.avg_resolution ? parseFloat(r.avg_resolution) : null,
  };
}

export async function getOperatorStatsPerOperator(period: string): Promise<OperatorStats[]> {
  const cond = periodCondition(period);
  const rows = await db.query<OperatorRow>(
    `WITH operator_convs AS (
       SELECT
         c.assigned_operator_id,
         c.id AS conv_id,
         c.first_response_at,
         c.resolved_at,
         c.created_at,
         c.csat_score
       FROM conversations c
       WHERE ${cond}
         AND c.assigned_operator_id IS NOT NULL
     ),
     msg_counts AS (
       SELECT
         oc.assigned_operator_id,
         COUNT(*) AS messages_sent
       FROM operator_convs oc
       JOIN messages m ON m.conversation_id = oc.conv_id AND m.sender_type = 'operator'
       GROUP BY oc.assigned_operator_id
     ),
     active_counts AS (
       SELECT
         assigned_operator_id,
         COUNT(*) AS active_sessions
       FROM conversations
       WHERE status IN ('open', 'active', 'waiting')
         AND assigned_operator_id IS NOT NULL
       GROUP BY assigned_operator_id
     )
     SELECT
       oc.assigned_operator_id AS operator_id,
       COALESCE(u.display_name, u.email, 'Оператор') AS operator_name,
       COUNT(DISTINCT oc.conv_id) AS chats_handled,
       COALESCE(mc.messages_sent, 0) AS messages_sent,
       EXTRACT(EPOCH FROM AVG(oc.first_response_at - oc.created_at)) AS avg_first_response,
       EXTRACT(EPOCH FROM AVG(oc.resolved_at - oc.created_at)) AS avg_resolution,
       COALESCE(ac.active_sessions, 0) AS active_sessions,
       ROUND(AVG(oc.csat_score)::numeric, 2) AS avg_csat
     FROM operator_convs oc
     LEFT JOIN users u ON u.id = oc.assigned_operator_id
     LEFT JOIN msg_counts mc ON mc.assigned_operator_id = oc.assigned_operator_id
     LEFT JOIN active_counts ac ON ac.assigned_operator_id = oc.assigned_operator_id
     GROUP BY oc.assigned_operator_id, u.display_name, u.email, mc.messages_sent, ac.active_sessions
     ORDER BY chats_handled DESC`
  );

  return rows.map(r => ({
    operator_id: r.operator_id,
    operator_name: r.operator_name,
    chats_handled: parseInt(r.chats_handled, 10),
    messages_sent: parseInt(r.messages_sent, 10),
    avg_first_response_sec: r.avg_first_response ? parseFloat(r.avg_first_response) : null,
    avg_resolution_sec: r.avg_resolution ? parseFloat(r.avg_resolution) : null,
    active_sessions: parseInt(r.active_sessions, 10),
    avg_csat: r.avg_csat ? parseFloat(r.avg_csat) : null,
  }));
}
