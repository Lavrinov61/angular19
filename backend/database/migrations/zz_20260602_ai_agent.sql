-- AI-агент: новые таблицы аудита (ai_agent_runs, ai_agent_tool_calls, ai_agent_confirmations)
-- + расширение conversations (режим агента) + dedup_key в outbound_queue.
-- Идемпотентно: IF NOT EXISTS + DO-блоки для CHECK-констрейнтов.
BEGIN;

-- =========================================================
-- 1. Расширяем conversations: поля управления режимом агента
-- =========================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_agent_mode varchar(12) DEFAULT 'off';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_agent_mode_set_by varchar(40);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_agent_locked_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_agent_turn_count int DEFAULT 0;

-- CHECK-констрейнт на ai_agent_mode (идемпотентно через DO-блок)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'conversations'
      AND constraint_name = 'conversations_ai_agent_mode_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_ai_agent_mode_check
      CHECK (ai_agent_mode IN ('off', 'suggest', 'bot', 'operator'));
  END IF;
END;
$$;

-- =========================================================
-- 2. ai_agent_runs — аудит запусков агента, стоимость, идемпотентность хода
-- =========================================================
CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES conversations(id),
  contact_id       uuid,
  user_id          uuid,
  channel          text,
  trigger_message_id uuid,
  status           text,
  mode_at_start    text,
  model            text,
  step_count       int DEFAULT 0,
  prompt_tokens    int,
  completion_tokens int,
  cost_usd         numeric(10,6),
  latency_ms       int,
  escalation_reason text,
  final_message_id uuid,
  suppressed_reason text,
  error            text,
  created_at       timestamptz DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (conversation_id, trigger_message_id)
);

-- CHECK на status (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ai_agent_runs'
      AND constraint_name = 'ai_agent_runs_status_check'
  ) THEN
    ALTER TABLE ai_agent_runs
      ADD CONSTRAINT ai_agent_runs_status_check
      CHECK (status IN ('running', 'completed', 'suppressed', 'escalated', 'failed'));
  END IF;
END;
$$;

-- =========================================================
-- 3. ai_agent_tool_calls — forensics каждого вызова инструмента
-- =========================================================
CREATE TABLE IF NOT EXISTS ai_agent_tool_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid REFERENCES ai_agent_runs(id) ON DELETE CASCADE,
  tool_name        text,
  risk_class       text,
  arguments_json   jsonb,
  validated_args   jsonb,
  outcome          text,
  result_summary   jsonb,
  idempotency_key  text,
  rejected_reason  text,
  duration_ms      int,
  created_at       timestamptz DEFAULT now()
);

-- CHECK на risk_class (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ai_agent_tool_calls'
      AND constraint_name = 'ai_agent_tool_calls_risk_class_check'
  ) THEN
    ALTER TABLE ai_agent_tool_calls
      ADD CONSTRAINT ai_agent_tool_calls_risk_class_check
      CHECK (risk_class IN ('read', 'write_draft', 'confirm_required', 'forbidden'));
  END IF;
END;
$$;

-- CHECK на outcome (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ai_agent_tool_calls'
      AND constraint_name = 'ai_agent_tool_calls_outcome_check'
  ) THEN
    ALTER TABLE ai_agent_tool_calls
      ADD CONSTRAINT ai_agent_tool_calls_outcome_check
      CHECK (outcome IN ('executed', 'rejected_schema', 'rejected_policy', 'awaiting_confirm', 'error', 'denied'));
  END IF;
END;
$$;

-- Unique-индекс на idempotency_key (только WHERE NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_tool_calls_idempotency_key
  ON ai_agent_tool_calls (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========================================================
-- 4. ai_agent_confirmations — для Этапа 3 (двойное подтверждение действий)
-- =========================================================
CREATE TABLE IF NOT EXISTS ai_agent_confirmations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid,
  run_id           uuid,
  action_type      text,
  draft_payload    jsonb,
  quoted_total     int,
  status           text DEFAULT 'pending',
  confirm_token    varchar(64),
  expires_at       timestamptz,
  confirmed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);

-- CHECK на status (идемпотентно)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ai_agent_confirmations'
      AND constraint_name = 'ai_agent_confirmations_status_check'
  ) THEN
    ALTER TABLE ai_agent_confirmations
      ADD CONSTRAINT ai_agent_confirmations_status_check
      CHECK (status IN ('pending', 'confirmed_client', 'confirmed_operator', 'expired', 'cancelled'));
  END IF;
END;
$$;

-- =========================================================
-- 5. outbound_queue: dedup_key для защиты от дублей на Этапе 2+
-- =========================================================
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS dedup_key varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_queue_dedup_key
  ON outbound_queue (dedup_key)
  WHERE dedup_key IS NOT NULL;

COMMIT;
