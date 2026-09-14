import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { parsePolygon } from "../geo.js";
import {
  organizationFor,
  parse,
  requireRoles,
  sendData,
  uuidSchema,
} from "../http.js";
import { encryptSecret, hashPassword } from "../security.js";
import { roles, type Role } from "../types.js";

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
});
const organizationPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const userSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(1024),
  role: z.enum(roles).exclude(["system_admin"]),
});
const userPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(12).max(1024).optional(),
  role: z.enum(roles).exclude(["system_admin"]).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const configSchema = z.object({
  satelliteEnabled: z.boolean(),
  satelliteEndpoint: z.string().url().nullable().default(null),
  satelliteApiKey: z.string().max(2048).nullable().optional(),
  evidencePackEnabled: z.boolean(),
  eu: z.object({
    mode: z.enum(["mock", "live"]),
    endpoint: z.string().url().nullable(),
    timeoutMs: z.number().int().min(1000).max(60000),
    username: z.string().max(512).nullable().optional(),
    password: z.string().max(2048).nullable().optional(),
    clientId: z.string().max(512).nullable().optional(),
  }),
  extra: z.record(z.unknown()).default({}),
}).superRefine((value, context) => {
  if (value.eu.mode === "live" && !value.eu.endpoint?.startsWith("https://")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["eu", "endpoint"],
      message: "Live mode requires an HTTPS endpoint.",
    });
  }
  if (Object.keys(value.extra).some((key) => /(secret|password|token|api.?key|credential)/i.test(key))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["extra"],
      message: "Secrets are not allowed in extra settings; use an encrypted secret field.",
    });
  }
});
const geofenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  polygon: z.unknown(),
  active: z.boolean().default(true),
});
const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).default(""),
});
const reconciliationSchema = z.object({
  decision: z.enum(["reset_not_submitted", "confirm_submitted"]),
  externalReference: z.string().trim().min(1).max(300).optional(),
  note: z.string().trim().min(1).max(2000),
}).superRefine((value, context) => {
  if (value.decision === "confirm_submitted" && !value.externalReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["externalReference"],
      message: "An external reference is required to confirm submission.",
    });
  }
});

function ensureOrgAdministration(request: FastifyRequest, organizationId: string): void {
  const auth = requireRoles(request, ["system_admin", "org_admin"]);
  if (auth.role !== "system_admin" && auth.organizationId !== organizationId) throw forbidden();
}

function apiConfig(row: Record<string, unknown>) {
  return {
    organizationId: row.organization_id,
    satelliteEnabled: row.satellite_enabled,
    satelliteEndpoint: row.satellite_endpoint,
    hasSatelliteApiKey: Boolean(row.satellite_api_key_ciphertext),
    evidencePackEnabled: row.evidence_pack_enabled,
    eu: {
      mode: row.eu_mode,
      endpoint: row.eu_endpoint,
      timeoutMs: row.eu_timeout_ms,
      hasUsername: Boolean(row.eu_username_ciphertext),
      hasPassword: Boolean(row.eu_password_ciphertext),
      hasClientId: Boolean(row.eu_client_id_ciphertext),
    },
    extra: row.extra_config,
    updatedAt: row.updated_at,
  };
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  const protectedRoute = { preHandler: authenticate };

  app.get("/api/v1/admin/organizations", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin", "reviewer", "auditor"]);
    const organizations = await withContext(pool, auth, (client) =>
      queryMany(client,
        `SELECT id, name, slug, active, created_at AS "createdAt", updated_at AS "updatedAt"
           FROM organizations ORDER BY name`));
    return sendData(reply, organizations);
  });

  app.post("/api/v1/admin/organizations", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin"]);
    const body = parse(organizationSchema, request.body);
    const organization = await withContext(pool, auth, async (client) => {
      const result = await queryOne<Record<string, unknown>>(client,
        `INSERT INTO organizations(name, slug) VALUES ($1, $2)
         RETURNING id, name, slug, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [body.name, body.slug]);
      await client.query(
        "INSERT INTO organization_api_config(organization_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [result!.id]);
      await writeAudit(client, request, auth, "organization.create", "organization", String(result!.id), {
        organizationId: result!.id,
      });
      return result;
    });
    return sendData(reply, organization, 201);
  });

  app.patch("/api/v1/admin/organizations/:organizationId", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin"]);
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    const body = parse(organizationPatchSchema, request.body);
    const organization = await withContext(pool, auth, async (client) => {
      const result = await queryOne(client,
        `UPDATE organizations
            SET name = COALESCE($2, name), active = COALESCE($3, active)
          WHERE id = $1
          RETURNING id, name, slug, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [organizationId, body.name ?? null, body.active ?? null]);
      if (!result) throw notFound("Organization");
      await writeAudit(client, request, auth, "organization.update", "organization", organizationId, {
        organizationId,
        ...body,
      });
      return result;
    });
    return sendData(reply, organization);
  });

  app.get("/api/v1/admin/organizations/:organizationId/users", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const users = await withContext(pool, auth, (client) =>
      queryMany(client,
        `SELECT id, organization_id AS "organizationId", email, display_name AS "displayName",
                role, active, created_at AS "createdAt", updated_at AS "updatedAt"
           FROM users WHERE organization_id = $1 ORDER BY email`,
        [organizationId]));
    return sendData(reply, users);
  });

  app.post("/api/v1/admin/organizations/:organizationId/users", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const body = parse(userSchema, request.body);
    const passwordHash = await hashPassword(body.password);
    const user = await withContext(pool, auth, async (client) => {
      const result = await queryOne(client,
        `INSERT INTO users(organization_id, email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id AS "organizationId", email,
                   display_name AS "displayName", role, active, created_at AS "createdAt"`,
        [organizationId, body.email, body.displayName, passwordHash, body.role]);
      await writeAudit(client, request, auth, "user.create", "user", String(result!.id), {
        organizationId,
        email: body.email,
        role: body.role,
      });
      return result;
    });
    return sendData(reply, user, 201);
  });

  app.patch("/api/v1/admin/organizations/:organizationId/users/:userId", protectedRoute, async (request, reply) => {
    const { organizationId, userId } = parse(
      z.object({ organizationId: uuidSchema, userId: uuidSchema }),
      request.params,
    );
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const body = parse(userPatchSchema, request.body);
    if (userId === auth.userId && body.active === false) {
      throw badRequest("SELF_DEACTIVATION", "You cannot deactivate your own account.");
    }
    const passwordHash = body.password ? await hashPassword(body.password) : null;
    const user = await withContext(pool, auth, async (client) => {
      const result = await queryOne(client,
        `UPDATE users
            SET display_name = COALESCE($3, display_name),
                password_hash = COALESCE($4, password_hash),
                role = COALESCE($5::user_role, role),
                active = COALESCE($6, active),
                token_version = CASE
                  WHEN $4::text IS NOT NULL OR $5::user_role IS NOT NULL OR $6::boolean = false
                  THEN token_version + 1 ELSE token_version END
          WHERE id = $1 AND organization_id = $2 AND role <> 'system_admin'
          RETURNING id, organization_id AS "organizationId", email,
                    display_name AS "displayName", role, active, updated_at AS "updatedAt"`,
        [
          userId,
          organizationId,
          body.displayName ?? null,
          passwordHash,
          body.role ?? null,
          body.active ?? null,
        ]);
      if (!result) throw notFound("User");
      if (passwordHash || body.role || body.active === false) {
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1",
          [userId],
        );
      }
      await writeAudit(client, request, auth, "user.update", "user", userId, {
        organizationId,
        displayName: body.displayName,
        role: body.role,
        active: body.active,
        passwordChanged: Boolean(body.password),
      });
      return result;
    });
    return sendData(reply, user);
  });

  app.get("/api/v1/admin/organizations/:organizationId/config", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const row = await withContext(pool, auth, (client) =>
      queryOne<Record<string, unknown>>(client,
        `SELECT * FROM organization_api_config WHERE organization_id = $1`,
        [organizationId]));
    if (!row) throw notFound("API configuration");
    return sendData(reply, apiConfig(row));
  });

  app.put("/api/v1/admin/organizations/:organizationId/config", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const body = parse(configSchema, request.body);
    const encrypt = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null || value === ""
        ? null
        : encryptSecret(config.CONFIG_ENCRYPTION_KEY, value);
    const username = encrypt(body.eu.username);
    const password = encrypt(body.eu.password);
    const clientId = encrypt(body.eu.clientId);
    const satelliteApiKey = encrypt(body.satelliteApiKey);
    const row = await withContext(pool, auth, async (client) => {
      const result = await queryOne<Record<string, unknown>>(client,
        `INSERT INTO organization_api_config (
           organization_id, satellite_enabled, satellite_endpoint,
           satellite_api_key_ciphertext, evidence_pack_enabled, eu_mode, eu_endpoint,
           eu_timeout_ms, eu_username_ciphertext, eu_password_ciphertext,
           eu_client_id_ciphertext, extra_config
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
         )
         ON CONFLICT (organization_id) DO UPDATE SET
           satellite_enabled = EXCLUDED.satellite_enabled,
           satellite_endpoint = EXCLUDED.satellite_endpoint,
           satellite_api_key_ciphertext = CASE WHEN $13 THEN EXCLUDED.satellite_api_key_ciphertext ELSE organization_api_config.satellite_api_key_ciphertext END,
           evidence_pack_enabled = EXCLUDED.evidence_pack_enabled,
           eu_mode = EXCLUDED.eu_mode,
           eu_endpoint = EXCLUDED.eu_endpoint,
           eu_timeout_ms = EXCLUDED.eu_timeout_ms,
           eu_username_ciphertext = CASE WHEN $14 THEN EXCLUDED.eu_username_ciphertext ELSE organization_api_config.eu_username_ciphertext END,
           eu_password_ciphertext = CASE WHEN $15 THEN EXCLUDED.eu_password_ciphertext ELSE organization_api_config.eu_password_ciphertext END,
           eu_client_id_ciphertext = CASE WHEN $16 THEN EXCLUDED.eu_client_id_ciphertext ELSE organization_api_config.eu_client_id_ciphertext END,
           extra_config = EXCLUDED.extra_config
         RETURNING *`,
        [
          organizationId,
          body.satelliteEnabled,
          body.satelliteEndpoint,
          satelliteApiKey ?? null,
          body.evidencePackEnabled,
          body.eu.mode,
          body.eu.endpoint,
          body.eu.timeoutMs,
          username ?? null,
          password ?? null,
          clientId ?? null,
          JSON.stringify(body.extra),
          satelliteApiKey !== undefined,
          username !== undefined,
          password !== undefined,
          clientId !== undefined,
        ]);
      await writeAudit(client, request, auth, "api_config.update", "organization", organizationId, {
        organizationId,
        satelliteEnabled: body.satelliteEnabled,
        satelliteEndpoint: body.satelliteEndpoint,
        evidencePackEnabled: body.evidencePackEnabled,
        euMode: body.eu.mode,
        euEndpoint: body.eu.endpoint,
        secretsChanged: {
          username: username !== undefined,
          password: password !== undefined,
          clientId: clientId !== undefined,
          satelliteApiKey: satelliteApiKey !== undefined,
        },
      });
      return result!;
    });
    return sendData(reply, apiConfig(row));
  });

  app.get("/api/v1/admin/organizations/:organizationId/geofences", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    organizationFor(request, organizationId);
    requireRoles(request, ["system_admin", "org_admin", "reviewer", "auditor"]);
    const rows = await withContext(pool, request.auth!, (client) =>
      queryMany(client,
        `SELECT id, organization_id AS "organizationId", name,
                ST_AsGeoJSON(polygon)::jsonb AS polygon, active,
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM geofences WHERE organization_id = $1 ORDER BY name`,
        [organizationId]));
    return sendData(reply, rows);
  });

  app.post("/api/v1/admin/organizations/:organizationId/geofences", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const body = parse(geofenceSchema, request.body);
    const polygon = parsePolygon(body.polygon);
    const row = await withContext(pool, auth, async (client) => {
      const result = await queryOne(client,
        `INSERT INTO geofences(organization_id, name, polygon, active, created_by)
         VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5)
         RETURNING id, organization_id AS "organizationId", name,
                   ST_AsGeoJSON(polygon)::jsonb AS polygon, active, created_at AS "createdAt"`,
        [organizationId, body.name, JSON.stringify(polygon), body.active, auth.userId]);
      await writeAudit(client, request, auth, "geofence.create", "geofence", String(result!.id), {
        organizationId,
        name: body.name,
      });
      return result;
    });
    return sendData(reply, row, 201);
  });

  app.patch("/api/v1/admin/organizations/:organizationId/geofences/:geofenceId", protectedRoute, async (request, reply) => {
    const { organizationId, geofenceId } = parse(
      z.object({ organizationId: uuidSchema, geofenceId: uuidSchema }),
      request.params,
    );
    ensureOrgAdministration(request, organizationId);
    const auth = request.auth!;
    const body = parse(geofenceSchema.partial().refine((value) => Object.keys(value).length > 0), request.body);
    const polygon = body.polygon === undefined ? null : parsePolygon(body.polygon);
    const row = await withContext(pool, auth, async (client) => {
      const result = await queryOne(client,
        `UPDATE geofences
            SET name = COALESCE($3, name),
                polygon = CASE WHEN $4::text IS NULL THEN polygon
                  ELSE ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) END,
                active = COALESCE($5, active)
          WHERE id = $1 AND organization_id = $2
          RETURNING id, organization_id AS "organizationId", name,
                    ST_AsGeoJSON(polygon)::jsonb AS polygon, active, updated_at AS "updatedAt"`,
        [geofenceId, organizationId, body.name ?? null, polygon ? JSON.stringify(polygon) : null, body.active ?? null]);
      if (!result) throw notFound("Geofence");
      await writeAudit(client, request, auth, "geofence.update", "geofence", geofenceId, {
        organizationId,
        name: body.name,
        active: body.active,
        geometryChanged: Boolean(polygon),
      });
      return result;
    });
    return sendData(reply, row);
  });

  app.get("/api/v1/admin/organizations/:organizationId/reviews", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    organizationFor(request, organizationId);
    requireRoles(request, ["system_admin", "org_admin", "reviewer", "auditor"]);
    const rows = await withContext(pool, request.auth!, async (client) => {
      const geofence = await queryMany(client,
        `SELECT id, 'geofence' AS type, entity_id AS "subjectId", status, reason,
                review_note AS "reviewNote", created_at AS "createdAt", reviewed_at AS "reviewedAt"
           FROM geofence_violations WHERE organization_id = $1`,
        [organizationId]);
      const dds = await queryMany(client,
        `SELECT r.id, 'dds' AS type, r.subject_id AS "subjectId", r.status,
                'DDS submission approval' AS reason, r.review_note AS "reviewNote",
                r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt"
           FROM review_requests r WHERE r.organization_id = $1`,
        [organizationId]);
      return [...geofence, ...dds].sort((a: any, b: any) =>
        String(b.createdAt).localeCompare(String(a.createdAt)));
    });
    return sendData(reply, rows);
  });

  app.post("/api/v1/admin/reviews/:type/:reviewId/decision", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin", "reviewer"]);
    const { type, reviewId } = parse(
      z.object({ type: z.enum(["geofence", "dds"]), reviewId: uuidSchema }),
      request.params,
    );
    const body = parse(reviewSchema, request.body);
    const result = await withContext(pool, auth, async (client) => {
      const table = type === "geofence" ? "geofence_violations" : "review_requests";
      const row = await queryOne<{ id: string; organization_id: string }>(client,
        `SELECT id, organization_id FROM ${table} WHERE id = $1`,
        [reviewId]);
      if (!row) throw notFound("Review");
      organizationFor(request, row.organization_id);
      const updated = await queryOne(client,
        `UPDATE ${table}
            SET status = $2::review_status, reviewed_by = $3, review_note = $4, reviewed_at = now()
          WHERE id = $1
          RETURNING id, organization_id AS "organizationId", status, review_note AS "reviewNote",
                    reviewed_at AS "reviewedAt"`,
        [reviewId, body.decision, auth.userId, body.note]);
      await writeAudit(client, request, auth, `review.${body.decision}`, type, reviewId, {
        organizationId: row.organization_id,
        note: body.note,
      });
      return updated;
    });
    return sendData(reply, result);
  });

  app.get("/api/v1/admin/organizations/:organizationId/dds-reconciliation", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    organizationFor(request, organizationId);
    const actions = await withContext(pool, auth, (client) =>
      queryMany(client,
        `SELECT a.id, a.operation_id AS "operationId", a.idempotency_key AS "idempotencyKey",
                a.status, a.error_code AS "errorCode", a.created_at AS "createdAt",
                a.updated_at AS "updatedAt", o.subject_id AS "subjectId",
                o.phase AS "operationPhase", o.message, o.external_reference AS "externalReference"
           FROM dds_actions a
           JOIN operational_requests o
             ON o.organization_id = a.organization_id AND o.id = a.operation_id
          WHERE a.organization_id = $1
            AND a.action = 'submit'
            AND a.status IN ('processing', 'uncertain')
          ORDER BY a.updated_at`,
        [organizationId]));
    return sendData(reply, actions);
  });

  app.post("/api/v1/admin/dds-actions/:actionId/reconcile", protectedRoute, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const { actionId } = parse(z.object({ actionId: uuidSchema }), request.params);
    const body = parse(reconciliationSchema, request.body);
    const result = await withContext(pool, auth, async (client) => {
      const action = await queryOne<{
        id: string;
        organization_id: string;
        operation_id: string;
        action: string;
        status: string;
        updated_at: Date;
      }>(client,
        `SELECT id, organization_id, operation_id, action, status, updated_at
           FROM dds_actions WHERE id = $1 FOR UPDATE`,
        [actionId]);
      if (!action || action.action !== "submit") throw notFound("DDS reconciliation action");
      organizationFor(request, action.organization_id);
      if (!["processing", "uncertain"].includes(action.status)) {
        throw conflict("DDS_ACTION_ALREADY_RESOLVED", "This DDS action has already been resolved.");
      }
      if (
        action.status === "processing" &&
        Date.now() - action.updated_at.getTime() < 120_000
      ) {
        throw conflict(
          "DDS_ACTION_STILL_PROCESSING",
          "Wait two minutes before reconciling a still-processing submission.",
        );
      }
      const operation = await queryOne<{
        id: string;
        kind: "dds";
        subject_id: string;
        status: string;
        phase: string | null;
        download_url: string | null;
        message: string | null;
        external_reference: string | null;
        updated_at: Date;
      }>(client,
        body.decision === "confirm_submitted"
          ? `UPDATE operational_requests
                SET status = 'completed', phase = 'submitted',
                    external_reference = $2, message = 'Submission confirmed by administrator reconciliation.'
              WHERE id = $1 RETURNING *`
          : `UPDATE operational_requests
                SET status = 'completed', phase = 'validated',
                    external_reference = NULL, message = 'Submission marked as not submitted by administrator reconciliation.'
              WHERE id = $1 RETURNING *`,
        body.decision === "confirm_submitted"
          ? [action.operation_id, body.externalReference]
          : [action.operation_id]);
      if (!operation) throw notFound("DDS draft");
      const operationData = {
        id: operation.id,
        kind: operation.kind,
        subjectId: operation.subject_id,
        status: operation.status,
        ...(operation.message ? { message: operation.message } : {}),
        ...(operation.external_reference
          ? { externalReference: operation.external_reference }
          : {}),
        phase: operation.phase,
        updatedAt: operation.updated_at.toISOString(),
      };
      const storedResponse = body.decision === "confirm_submitted"
        ? { ok: true, statusCode: 200, data: operationData }
        : {
            ok: false,
            statusCode: 409,
            error: {
              code: "DDS_RECONCILED_NOT_SUBMITTED",
              message: "The submission was reconciled as not submitted; use a new idempotency key to retry.",
            },
          };
      await client.query(
        `UPDATE dds_actions
            SET status = $2, response = $3::jsonb, error_code = $4,
                resolved_by = $5, resolution_note = $6, resolved_at = now()
          WHERE id = $1`,
        [
          action.id,
          body.decision === "confirm_submitted" ? "completed" : "failed",
          JSON.stringify(storedResponse),
          body.decision === "confirm_submitted" ? null : "DDS_RECONCILED_NOT_SUBMITTED",
          auth.userId,
          body.note,
        ],
      );
      await writeAudit(
        client,
        request,
        auth,
        body.decision === "confirm_submitted"
          ? "dds.reconcile.confirm_submitted"
          : "dds.reconcile.reset_not_submitted",
        "dds",
        action.operation_id,
        {
          organizationId: action.organization_id,
          actionId: action.id,
          externalReference: body.externalReference,
          note: body.note,
        },
      );
      return {
        actionId: action.id,
        decision: body.decision,
        operation: operationData,
      };
    });
    return sendData(reply, result);
  });

  app.get("/api/v1/admin/organizations/:organizationId/audit-logs", protectedRoute, async (request, reply) => {
    const { organizationId } = parse(z.object({ organizationId: uuidSchema }), request.params);
    organizationFor(request, organizationId);
    requireRoles(request, ["system_admin", "org_admin", "auditor"]);
    const query = parse(z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      before: z.coerce.date().optional(),
    }), request.query);
    const rows = await withContext(pool, request.auth!, (client) =>
      queryMany(client,
        `SELECT id, actor_user_id AS "actorUserId", action, resource_type AS "resourceType",
                resource_id AS "resourceId", ip::text, details, created_at AS "createdAt"
           FROM audit_logs
          WHERE organization_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
          ORDER BY created_at DESC LIMIT $3`,
        [organizationId, query.before ?? null, query.limit]));
    return sendData(reply, rows);
  });
}
