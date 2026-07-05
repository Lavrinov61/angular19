-- Persist a sanitized snapshot of what the AI agent sent to the model.
-- This is for debugging hallucinations without storing raw customer PII.

ALTER TABLE ai_agent_runs
  ADD COLUMN IF NOT EXISTS request_trace jsonb;

COMMENT ON COLUMN ai_agent_runs.request_trace IS
  'Sanitized model-input trace: provider/model, system prompt, message summaries, tools, model tool calls and compact tool results.';
