INSERT INTO organization_api_config (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;
