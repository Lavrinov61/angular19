-- Migration 143: B2B automation foundation
-- Date: 2026-05-15
-- Context: production B2B billing, verification, ledger, bank statement matching,
-- document packages and EDO status tracking for print billing.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS public.b2b_invoice_number_seq;

CREATE OR REPLACE FUNCTION public.b2b_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.b2b_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'suspended', 'closed')),
    verification_status VARCHAR(32) NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN (
            'unverified', 'pending', 'bank_identity_verified', 'verified',
            'mismatch', 'manual_review', 'rejected'
        )),
    inn VARCHAR(12) NOT NULL CHECK (inn ~ '^[0-9]{10}([0-9]{2})?$'),
    kpp VARCHAR(9) CHECK (kpp IS NULL OR kpp ~ '^[0-9]{9}$'),
    ogrn VARCHAR(15) CHECK (ogrn IS NULL OR ogrn ~ '^[0-9]{13}([0-9]{2})?$'),
    legal_name TEXT NOT NULL,
    short_name TEXT,
    legal_address TEXT,
    postal_address TEXT,
    accountant_email TEXT,
    accountant_phone TEXT,
    edo_provider VARCHAR(64),
    edo_operator_id TEXT,
    tax_system VARCHAR(32),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_organizations IS 'B2B legal entities and individual entrepreneurs using print billing.';
COMMENT ON COLUMN public.b2b_organizations.verification_status IS 'Business verification lifecycle, separate from payment status.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_organizations_inn_kpp
    ON public.b2b_organizations (inn, (COALESCE(kpp, '')));
CREATE INDEX IF NOT EXISTS idx_b2b_organizations_status
    ON public.b2b_organizations(status, verification_status);
CREATE INDEX IF NOT EXISTS idx_b2b_organizations_created_by
    ON public.b2b_organizations(created_by);

CREATE TABLE IF NOT EXISTS public.b2b_cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    code VARCHAR(64),
    name TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    monthly_limit NUMERIC(14,2) CHECK (monthly_limit IS NULL OR monthly_limit >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_cost_centers_org_code
    ON public.b2b_cost_centers(organization_id, code)
    WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_cost_centers_org
    ON public.b2b_cost_centers(organization_id, status);

CREATE TABLE IF NOT EXISTS public.b2b_organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    cost_center_id UUID REFERENCES public.b2b_cost_centers(id) ON DELETE SET NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'employee'
        CHECK (role IN ('owner', 'accountant', 'manager', 'employee')),
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'invited', 'disabled')),
    invited_email TEXT,
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_members_org_user
    ON public.b2b_organization_members(organization_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_members_org_invite_email
    ON public.b2b_organization_members(organization_id, lower(invited_email))
    WHERE invited_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_members_user
    ON public.b2b_organization_members(user_id, status)
    WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.b2b_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    contract_number TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'suspended', 'terminated', 'expired')),
    payment_terms VARCHAR(16) NOT NULL DEFAULT 'prepaid'
        CHECK (payment_terms IN ('prepaid', 'postpaid', 'mixed')),
    credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    payment_due_days INTEGER NOT NULL DEFAULT 5 CHECK (payment_due_days >= 0 AND payment_due_days <= 365),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    edo_required BOOLEAN NOT NULL DEFAULT true,
    offer_accepted_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    starts_at DATE,
    ends_at DATE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_contracts_org_active
    ON public.b2b_contracts(organization_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_b2b_contracts_org_status
    ON public.b2b_contracts(organization_id, status);

CREATE TABLE IF NOT EXISTS public.b2b_billing_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'blocked', 'closed')),
    payment_mode VARCHAR(16) NOT NULL DEFAULT 'prepaid'
        CHECK (payment_mode IN ('prepaid', 'postpaid', 'mixed')),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    block_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_billing_accounts_status
    ON public.b2b_billing_accounts(status, payment_mode);

CREATE TABLE IF NOT EXISTS public.b2b_organization_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    provider_type VARCHAR(24) NOT NULL
        CHECK (provider_type IN ('bank_identity', 'edo', 'first_payment', 'manual', 'fns')),
    provider_code VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'redirected', 'authorized', 'verified', 'mismatch',
            'insufficient_permissions', 'expired', 'revoked', 'failed', 'rejected'
        )),
    external_subject_hash TEXT,
    state_hash TEXT,
    nonce_hash TEXT,
    requested_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    consented_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code TEXT,
    error_message TEXT,
    started_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_verifications_state_hash
    ON public.b2b_organization_verifications(state_hash)
    WHERE state_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_verifications_org_status
    ON public.b2b_organization_verifications(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_verifications_provider
    ON public.b2b_organization_verifications(provider_type, provider_code, created_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_external_identity_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    provider_code VARCHAR(64) NOT NULL,
    external_org_hash TEXT NOT NULL,
    external_user_hash TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_external_identity_provider_org
    ON public.b2b_external_identity_links(provider_code, external_org_hash);
CREATE INDEX IF NOT EXISTS idx_b2b_external_identity_org
    ON public.b2b_external_identity_links(organization_id, status);

CREATE TABLE IF NOT EXISTS public.b2b_service_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closing', 'closed', 'documents_generated', 'cancelled')),
    closed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_service_periods_org_range
    ON public.b2b_service_periods(organization_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_b2b_service_periods_status
    ON public.b2b_service_periods(status, period_end DESC);

CREATE TABLE IF NOT EXISTS public.b2b_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL REFERENCES public.b2b_billing_accounts(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL UNIQUE,
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'paid', 'partially_paid', 'overdue', 'cancelled')),
    payment_purpose TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    period_start DATE,
    period_end DATE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (paid_amount <= amount),
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_b2b_invoices_org_status
    ON public.b2b_invoices(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_invoices_due
    ON public.b2b_invoices(due_at)
    WHERE status IN ('issued', 'partially_paid', 'overdue');

CREATE TABLE IF NOT EXISTS public.b2b_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.b2b_invoices(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL CHECK (line_number > 0),
    description TEXT NOT NULL,
    quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_invoice_lines_number
    ON public.b2b_invoice_lines(invoice_id, line_number);

CREATE TABLE IF NOT EXISTS public.b2b_bank_statement_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_code VARCHAR(64) NOT NULL DEFAULT 'sber',
    account_number_hash TEXT,
    statement_from TIMESTAMPTZ NOT NULL,
    statement_to TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'imported', 'failed')),
    external_statement_id TEXT,
    raw_hash TEXT,
    imported_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (statement_to >= statement_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_statement_imports_external
    ON public.b2b_bank_statement_imports(provider_code, external_statement_id)
    WHERE external_statement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_statement_imports_status
    ON public.b2b_bank_statement_imports(provider_code, status, statement_to DESC);

CREATE TABLE IF NOT EXISTS public.b2b_bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID REFERENCES public.b2b_bank_statement_imports(id) ON DELETE SET NULL,
    provider_code VARCHAR(64) NOT NULL DEFAULT 'sber',
    external_transaction_id TEXT,
    operation_date DATE NOT NULL,
    posted_at TIMESTAMPTZ,
    payer_inn VARCHAR(12) CHECK (payer_inn IS NULL OR payer_inn ~ '^[0-9]{10}([0-9]{2})?$'),
    payer_kpp VARCHAR(9) CHECK (payer_kpp IS NULL OR payer_kpp ~ '^[0-9]{9}$'),
    payer_name TEXT,
    payer_account_hash TEXT,
    recipient_account_hash TEXT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    payment_purpose TEXT,
    direction VARCHAR(16) NOT NULL DEFAULT 'incoming'
        CHECK (direction IN ('incoming', 'outgoing')),
    status VARCHAR(16) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'matched', 'ignored', 'reversed')),
    raw_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_bank_transactions_external
    ON public.b2b_bank_transactions(provider_code, external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_bank_transactions_payer
    ON public.b2b_bank_transactions(payer_inn, operation_date DESC)
    WHERE payer_inn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_bank_transactions_status
    ON public.b2b_bank_transactions(status, operation_date DESC);

CREATE TABLE IF NOT EXISTS public.b2b_print_job_usages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    billing_account_id UUID NOT NULL REFERENCES public.b2b_billing_accounts(id) ON DELETE RESTRICT,
    service_period_id UUID REFERENCES public.b2b_service_periods(id) ON DELETE SET NULL,
    print_job_id UUID REFERENCES public.print_jobs(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    member_id UUID REFERENCES public.b2b_organization_members(id) ON DELETE SET NULL,
    cost_center_id UUID REFERENCES public.b2b_cost_centers(id) ON DELETE SET NULL,
    printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    service_slug TEXT,
    pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies > 0),
    color_mode VARCHAR(32),
    paper_size VARCHAR(32),
    duplex BOOLEAN,
    unit_price NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'posted', 'reversed', 'cancelled')),
    tariff_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_print_job_usages_print_job
    ON public.b2b_print_job_usages(print_job_id)
    WHERE print_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_print_job_usages_org_period
    ON public.b2b_print_job_usages(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_print_job_usages_status
    ON public.b2b_print_job_usages(status, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_balance_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE RESTRICT,
    billing_account_id UUID NOT NULL REFERENCES public.b2b_billing_accounts(id) ON DELETE RESTRICT,
    entry_type VARCHAR(32) NOT NULL
        CHECK (entry_type IN (
            'top_up', 'print_usage', 'invoice_charge', 'payment_apply',
            'refund', 'correction', 'hold', 'release', 'document_adjustment'
        )),
    direction VARCHAR(8) NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    invoice_id UUID REFERENCES public.b2b_invoices(id) ON DELETE RESTRICT,
    bank_transaction_id UUID REFERENCES public.b2b_bank_transactions(id) ON DELETE RESTRICT,
    print_job_usage_id UUID REFERENCES public.b2b_print_job_usages(id) ON DELETE RESTRICT,
    source_type VARCHAR(64),
    source_id TEXT,
    idempotency_key TEXT,
    description TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_balance_ledger IS 'Immutable financial ledger for B2B billing. Balance is derived from entries.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_ledger_idempotency_key
    ON public.b2b_balance_ledger(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_ledger_account_time
    ON public.b2b_balance_ledger(billing_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_ledger_org_time
    ON public.b2b_balance_ledger(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.b2b_prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'b2b_balance_ledger is immutable; write correction entries instead';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_b2b_balance_ledger_immutable'
    ) THEN
        CREATE TRIGGER trg_b2b_balance_ledger_immutable
        BEFORE UPDATE OR DELETE ON public.b2b_balance_ledger
        FOR EACH ROW EXECUTE FUNCTION public.b2b_prevent_ledger_mutation();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.b2b_payment_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    bank_transaction_id UUID NOT NULL REFERENCES public.b2b_bank_transactions(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES public.b2b_invoices(id) ON DELETE SET NULL,
    ledger_entry_id UUID REFERENCES public.b2b_balance_ledger(id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'applied', 'rejected', 'reversed')),
    match_type VARCHAR(16) NOT NULL
        CHECK (match_type IN ('exact', 'fallback', 'manual', 'split', 'overpayment')),
    confidence NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
    matched_amount NUMERIC(14,2) NOT NULL CHECK (matched_amount > 0),
    matched_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    matched_at TIMESTAMPTZ,
    note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_payment_matches_active
    ON public.b2b_payment_matches(bank_transaction_id, invoice_id)
    WHERE status IN ('proposed', 'applied');
CREATE INDEX IF NOT EXISTS idx_b2b_payment_matches_org_status
    ON public.b2b_payment_matches(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_document_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    service_period_id UUID REFERENCES public.b2b_service_periods(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES public.b2b_invoices(id) ON DELETE SET NULL,
    document_type VARCHAR(24) NOT NULL
        CHECK (document_type IN ('invoice', 'act', 'upd', 'reconciliation', 'correction')),
    package_number TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'generated', 'sent', 'delivered', 'signed', 'rejected', 'corrected', 'cancelled')),
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    generated_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_document_packages_number_version
    ON public.b2b_document_packages(organization_id, package_number, version);
CREATE INDEX IF NOT EXISTS idx_b2b_document_packages_org_status
    ON public.b2b_document_packages(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_document_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_package_id UUID NOT NULL REFERENCES public.b2b_document_packages(id) ON DELETE CASCADE,
    file_kind VARCHAR(16) NOT NULL CHECK (file_kind IN ('pdf', 'xml', 'attachment', 'registry')),
    storage_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_b2b_document_files_kind_version
    ON public.b2b_document_files(document_package_id, file_kind, version);

CREATE TABLE IF NOT EXISTS public.b2b_edo_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_package_id UUID NOT NULL REFERENCES public.b2b_document_packages(id) ON DELETE CASCADE,
    provider_code VARCHAR(64) NOT NULL,
    provider_document_id TEXT,
    provider_message_id TEXT,
    direction VARCHAR(16) NOT NULL DEFAULT 'outgoing'
        CHECK (direction IN ('outgoing', 'incoming')),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'delivered', 'signed', 'rejected', 'corrected', 'cancelled', 'failed')),
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_edo_messages_package
    ON public.b2b_edo_messages(document_package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_edo_messages_provider_status
    ON public.b2b_edo_messages(provider_code, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_reconciliation_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.b2b_organizations(id) ON DELETE CASCADE,
    task_type VARCHAR(32) NOT NULL
        CHECK (task_type IN (
            'payment_unmatched', 'payment_ambiguous', 'verification_mismatch',
            'ledger_mismatch', 'edo_error', 'document_error'
        )),
    status VARCHAR(16) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
    priority VARCHAR(16) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    bank_transaction_id UUID REFERENCES public.b2b_bank_transactions(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES public.b2b_invoices(id) ON DELETE SET NULL,
    verification_id UUID REFERENCES public.b2b_organization_verifications(id) ON DELETE SET NULL,
    document_package_id UUID REFERENCES public.b2b_document_packages(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_reconciliation_tasks_status
    ON public.b2b_reconciliation_tasks(status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_reconciliation_tasks_org
    ON public.b2b_reconciliation_tasks(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.b2b_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.b2b_organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_type VARCHAR(16) NOT NULL DEFAULT 'user'
        CHECK (actor_type IN ('user', 'admin', 'system', 'worker', 'provider')),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    before_snapshot JSONB,
    after_snapshot JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_audit_log_org_time
    ON public.b2b_audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_audit_log_entity
    ON public.b2b_audit_log(entity_type, entity_id, created_at DESC)
    WHERE entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.b2b_idempotency_keys (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    request_hash TEXT,
    response_snapshot JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_b2b_idempotency_expires
    ON public.b2b_idempotency_keys(expires_at);

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT * FROM (VALUES
            ('trg_b2b_organizations_touch_updated_at', 'b2b_organizations'),
            ('trg_b2b_cost_centers_touch_updated_at', 'b2b_cost_centers'),
            ('trg_b2b_members_touch_updated_at', 'b2b_organization_members'),
            ('trg_b2b_contracts_touch_updated_at', 'b2b_contracts'),
            ('trg_b2b_billing_accounts_touch_updated_at', 'b2b_billing_accounts'),
            ('trg_b2b_verifications_touch_updated_at', 'b2b_organization_verifications'),
            ('trg_b2b_identity_links_touch_updated_at', 'b2b_external_identity_links'),
            ('trg_b2b_service_periods_touch_updated_at', 'b2b_service_periods'),
            ('trg_b2b_invoices_touch_updated_at', 'b2b_invoices'),
            ('trg_b2b_statement_imports_touch_updated_at', 'b2b_bank_statement_imports'),
            ('trg_b2b_bank_transactions_touch_updated_at', 'b2b_bank_transactions'),
            ('trg_b2b_print_usages_touch_updated_at', 'b2b_print_job_usages'),
            ('trg_b2b_payment_matches_touch_updated_at', 'b2b_payment_matches'),
            ('trg_b2b_document_packages_touch_updated_at', 'b2b_document_packages'),
            ('trg_b2b_edo_messages_touch_updated_at', 'b2b_edo_messages'),
            ('trg_b2b_reconciliation_tasks_touch_updated_at', 'b2b_reconciliation_tasks')
        ) AS t(trigger_name, table_name)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = rec.trigger_name) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.b2b_touch_updated_at()',
                rec.trigger_name,
                rec.table_name
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
