BEGIN;

CREATE TABLE IF NOT EXISTS public.pos_fiscal_settings (
    studio_id uuid PRIMARY KEY REFERENCES public.studios(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
    enabled boolean DEFAULT true NOT NULL,
    receipt_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    slip_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    shift_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pos_fiscal_settings_agent_id
    ON public.pos_fiscal_settings USING btree (agent_id);

DROP TRIGGER IF EXISTS trg_pos_fiscal_settings_updated_at ON public.pos_fiscal_settings;
CREATE TRIGGER trg_pos_fiscal_settings_updated_at
    BEFORE UPDATE ON public.pos_fiscal_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pos_transactions
    ADD COLUMN IF NOT EXISTS command_payload jsonb DEFAULT '{}'::jsonb NOT NULL;

COMMIT;
