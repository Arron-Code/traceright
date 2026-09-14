ALTER TABLE plots
  ADD COLUMN geofence_status text NOT NULL DEFAULT 'pending'
    CHECK (geofence_status IN ('pending', 'inside', 'outside', 'review_required', 'approved')),
  ADD COLUMN local_geofence_result text NOT NULL DEFAULT 'pending'
    CHECK (local_geofence_result IN ('pending', 'inside', 'outside'));

ALTER TABLE operational_requests
  ADD CONSTRAINT operational_requests_org_id_unique UNIQUE (organization_id, id);

CREATE TABLE dds_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('validate', 'submit')),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed', 'uncertain')),
  response jsonb,
  error_code text,
  created_by uuid NOT NULL REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, operation_id)
    REFERENCES operational_requests(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX dds_actions_reconciliation_idx
  ON dds_actions(organization_id, status, updated_at DESC)
  WHERE status IN ('processing', 'uncertain');

CREATE TRIGGER dds_actions_set_updated_at
  BEFORE UPDATE ON dds_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE dds_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dds_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY dds_actions_tenant_policy ON dds_actions
  USING (app_system_admin() OR organization_id = app_organization_id())
  WITH CHECK (app_system_admin() OR organization_id = app_organization_id());
