import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { AuthContext } from "./types.js";

export async function writeAudit(
  client: PoolClient,
  request: FastifyRequest,
  auth: AuthContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const targetOrganizationId =
    typeof details.organizationId === "string" ? details.organizationId : auth.organizationId;
  await client.query(
    `INSERT INTO audit_logs
      (organization_id, actor_user_id, action, resource_type, resource_id, ip, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8::jsonb)`,
    [
      targetOrganizationId,
      auth.userId,
      action,
      resourceType,
      resourceId,
      request.ip,
      request.headers["user-agent"] ?? null,
      JSON.stringify(details),
    ],
  );
}
