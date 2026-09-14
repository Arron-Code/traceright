CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('system_admin', 'org_admin', 'reviewer', 'field_agent', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'system_admin' AND organization_id IS NULL) OR
         (role <> 'system_admin' AND organization_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_org_email_unique
  ON users (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  rotated_from_id uuid REFERENCES refresh_tokens(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS organization_api_config (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  satellite_enabled boolean NOT NULL DEFAULT false,
  satellite_endpoint text,
  satellite_api_key_ciphertext text,
  evidence_pack_enabled boolean NOT NULL DEFAULT true,
  eu_mode text NOT NULL DEFAULT 'mock' CHECK (eu_mode IN ('mock', 'live')),
  eu_endpoint text,
  eu_timeout_ms integer NOT NULL DEFAULT 15000 CHECK (eu_timeout_ms BETWEEN 1000 AND 60000),
  eu_username_ciphertext text,
  eu_password_ciphertext text,
  eu_client_id_ciphertext text,
  extra_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  region text NOT NULL DEFAULT '',
  producer_count integer NOT NULL DEFAULT 0 CHECK (producer_count >= 0),
  plot_count integer NOT NULL DEFAULT 0 CHECK (plot_count >= 0),
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

CREATE TABLE IF NOT EXISTS plots (
  id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid,
  producer text NOT NULL,
  farm_name text NOT NULL,
  area_ha numeric(14,4) NOT NULL CHECK (area_ha > 0),
  polygon geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(polygon)),
  captured_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS plots_polygon_gix ON plots USING gist(polygon);

CREATE TABLE IF NOT EXISTS geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  polygon geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(polygon)),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geofences_polygon_gix ON geofences USING gist(polygon);
CREATE INDEX IF NOT EXISTS geofences_org_idx ON geofences(organization_id);

CREATE TABLE IF NOT EXISTS geofence_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('plot')),
  entity_id uuid NOT NULL,
  payload_hash text NOT NULL,
  geometry geometry(Polygon, 4326) NOT NULL CHECK (ST_IsValid(geometry)),
  status review_status NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, entity_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS geofence_violations_org_status_idx
  ON geofence_violations(organization_id, status);

CREATE TABLE IF NOT EXISTS sync_operations (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  operation_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  sequence_id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('supplier', 'plot')),
  entity_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_changes_org_sequence_idx
  ON sync_changes(organization_id, sequence_id);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'uploaded', 'completed', 'failed')),
  storage_key text NOT NULL UNIQUE,
  upload_token_hash text NOT NULL,
  sha256 text,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operational_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('satellite', 'evidence_pack', 'dds')),
  subject_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'not_configured')),
  phase text,
  download_url text,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_reference text,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, idempotency_key)
);

CREATE TABLE IF NOT EXISTS review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('dds')),
  subject_id uuid NOT NULL,
  status review_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  ip inet,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
  ON audit_logs(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'users', 'organization_api_config', 'suppliers',
    'plots', 'geofences', 'documents', 'operational_requests'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name, table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app_system_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.is_system_admin', true), 'false') = 'true'
$$;

CREATE OR REPLACE FUNCTION app_organization_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_organization', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_tenant_policy ON organizations;
CREATE POLICY organizations_tenant_policy ON organizations
  USING (app_system_admin() OR id = app_organization_id())
  WITH CHECK (app_system_admin() OR id = app_organization_id());

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'refresh_tokens', 'organization_api_config', 'suppliers', 'plots',
    'geofences', 'geofence_violations', 'sync_operations', 'sync_changes',
    'documents', 'operational_requests', 'review_requests', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (app_system_admin() OR organization_id = app_organization_id()) WITH CHECK (app_system_admin() OR organization_id = app_organization_id())',
      table_name, table_name
    );
  END LOOP;
END $$;
