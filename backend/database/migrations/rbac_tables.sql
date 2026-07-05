-- ============================================================================
-- RBAC Tables Migration
-- NOTE: Table "permissions" already exists for photo consent. Using "rbac_" prefix.
-- ============================================================================

-- 1. rbac_permissions — canonical list of all permission slugs
CREATE TABLE IF NOT EXISTS rbac_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    module VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_permissions_slug ON rbac_permissions(slug);
CREATE INDEX IF NOT EXISTS idx_rbac_permissions_module ON rbac_permissions(module);

-- 2. rbac_roles — canonical list of roles
CREATE TABLE IF NOT EXISTS rbac_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(30) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. rbac_role_permissions — M:N linking roles to permissions
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    role_id UUID NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_rbac_rp_role ON rbac_role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_rbac_rp_perm ON rbac_role_permissions(permission_id);

-- 4. rbac_user_overrides — per-user grant/deny overrides
CREATE TABLE IF NOT EXISTS rbac_user_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    override_type VARCHAR(5) NOT NULL CHECK (override_type IN ('grant', 'deny')),
    reason TEXT,
    granted_by UUID REFERENCES users(id),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_rbac_upo_user ON rbac_user_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_upo_expires ON rbac_user_overrides(expires_at)
    WHERE expires_at IS NOT NULL;

-- 5. rbac_audit_log — tracks all RBAC changes
CREATE TABLE IF NOT EXISTS rbac_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id),
    actor_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    target_user_id UUID REFERENCES users(id),
    target_role_id UUID REFERENCES rbac_roles(id),
    target_permission_id UUID REFERENCES rbac_permissions(id),
    details JSONB DEFAULT '{}',
    ip VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_target_user ON rbac_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_created ON rbac_audit_log(created_at DESC);
