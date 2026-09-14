import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryOne, withContext } from "../db.js";
import { AppError, conflict, notFound } from "../errors.js";
import { authOf, parse, sendData, uuidSchema } from "../http.js";
import { EuSubmissionError, submitDds, type EuAdapterConfig } from "../soap.js";

type OperationKind = "satellite" | "evidence_pack" | "dds";
type OperationRow = {
  id: string;
  organization_id: string;
  kind: OperationKind;
  subject_id: string;
  status: string;
  phase: string | null;
  download_url: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  external_reference: string | null;
  updated_at: Date;
};
export type DdsActionName = "validate" | "submit";
export type StoredDdsActionResponse =
  | { ok: true; statusCode: number; data: ReturnType<typeof operationJson> }
  | {
      ok: false;
      statusCode: number;
      error: { code: string; message: string; details?: unknown };
    };
type DdsActionRow = {
  id: string;
  operation_id: string;
  action: DdsActionName;
  idempotency_key: string;
  status: "processing" | "completed" | "failed" | "uncertain";
  response: StoredDdsActionResponse | null;
};

const createSchema = z.object({ subjectId: z.string().trim().min(1).max(200) });

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  }
  return value;
}

function operationJson(row: OperationRow) {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    status: row.status,
    ...(row.download_url ? { downloadUrl: row.download_url } : {}),
    ...(row.message ? { message: row.message } : {}),
    ...(row.external_reference ? { externalReference: row.external_reference } : {}),
    phase: row.phase,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function assertDdsActionBinding(
  action: Pick<DdsActionRow, "operation_id" | "action">,
  operationId: string,
  actionName: DdsActionName,
): void {
  if (action.operation_id !== operationId || action.action !== actionName) {
    throw conflict(
      "IDEMPOTENCY_KEY_REUSED",
      "The idempotency key was already used for another DDS operation or action.",
    );
  }
}

function storedError(error: AppError): StoredDdsActionResponse {
  return {
    ok: false,
    statusCode: error.statusCode,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function replayDdsAction(
  action: Pick<DdsActionRow, "status" | "response">,
): StoredDdsActionResponse {
  if (action.response) return action.response;
  if (action.status === "processing") {
    return storedError(conflict(
      "DDS_ACTION_PROCESSING",
      "This DDS action is already processing and will not be submitted again.",
    ));
  }
  return storedError(conflict(
    "DDS_RECONCILIATION_REQUIRED",
    "The previous DDS result is uncertain and requires administrator reconciliation.",
  ));
}

function sendStoredAction(reply: FastifyReply, response: StoredDdsActionResponse) {
  return response.ok
    ? sendData(reply, response.data, response.statusCode)
    : reply.code(response.statusCode).send({ error: response.error });
}

async function lockDdsActionKey(
  client: PoolClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${organizationId}:${idempotencyKey}`],
  );
}

async function findDdsAction(
  client: PoolClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<DdsActionRow | null> {
  return queryOne<DdsActionRow>(client,
    `SELECT id, operation_id, action, idempotency_key, status, response
       FROM dds_actions
      WHERE organization_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [organizationId, idempotencyKey]);
}

async function createDdsAction(
  client: PoolClient,
  organizationId: string,
  operationId: string,
  action: DdsActionName,
  idempotencyKey: string,
  userId: string,
): Promise<DdsActionRow> {
  return (await queryOne<DdsActionRow>(client,
    `INSERT INTO dds_actions(
       organization_id, operation_id, action, idempotency_key, status, created_by
     ) VALUES ($1, $2, $3, $4, 'processing', $5)
     RETURNING id, operation_id, action, idempotency_key, status, response`,
    [organizationId, operationId, action, idempotencyKey, userId]))!;
}

async function completeDdsAction(
  client: PoolClient,
  actionId: string,
  status: "completed" | "failed" | "uncertain",
  response: StoredDdsActionResponse,
  errorCode: string | null = null,
): Promise<void> {
  await client.query(
    `UPDATE dds_actions
        SET status = $2, response = $3::jsonb, error_code = $4
      WHERE id = $1`,
    [actionId, status, JSON.stringify(response), errorCode],
  );
}

async function assertNoPendingGeofence(client: PoolClient, organizationId: string): Promise<void> {
  const pending = await queryOne<{ count: number }>(client,
    `SELECT count(*)::int AS count FROM geofence_violations
      WHERE organization_id = $1 AND status <> 'approved'`,
    [organizationId]);
  if ((pending?.count ?? 0) > 0) {
    throw conflict(
      "GEOFENCE_REVIEW_REQUIRED",
      "DDS is blocked until all geofence violations are approved.",
      { pendingViolations: pending!.count },
    );
  }
}

async function loadOperation(
  client: PoolClient,
  organizationId: string,
  kind: OperationKind,
  id: string,
  forUpdate = false,
): Promise<OperationRow> {
  const row = await queryOne<OperationRow>(client,
    `SELECT * FROM operational_requests
      WHERE id = $1 AND organization_id = $2 AND kind = $3 ${forUpdate ? "FOR UPDATE" : ""}`,
    [id, organizationId, kind]);
  if (!row) throw notFound("Operation");
  return row;
}

export async function registerOperationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  const protectedRoute = { preHandler: authenticate };

  async function createOperation(
    request: FastifyRequest,
    kind: OperationKind,
  ): Promise<{ operation: OperationRow; created: boolean }> {
    const auth = authOf(request);
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (!["org_admin", "reviewer", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot create operational requests.");
    }
    const body = parse(createSchema, request.body);
    const idempotencyKey = requireIdempotencyKey(request);
    return withContext(pool, auth, async (client) => {
      const existing = await queryOne<OperationRow>(client,
        `SELECT * FROM operational_requests
          WHERE organization_id = $1 AND kind = $2 AND idempotency_key = $3`,
        [auth.organizationId, kind, idempotencyKey]);
      if (existing) {
        if (existing.subject_id !== body.subjectId) {
          throw conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used for another subject.",
          );
        }
        return { operation: existing, created: false };
      }
      if (kind === "dds") await assertNoPendingGeofence(client, auth.organizationId!);
      const apiConfig = await queryOne<{
        satellite_enabled: boolean;
        evidence_pack_enabled: boolean;
      }>(client,
        `SELECT satellite_enabled, evidence_pack_enabled
           FROM organization_api_config WHERE organization_id = $1`,
        [auth.organizationId]);
      const enabled = kind === "satellite"
        ? Boolean(apiConfig?.satellite_enabled)
        : kind === "evidence_pack"
          ? (apiConfig?.evidence_pack_enabled ?? true)
          : true;
      const row = await queryOne<OperationRow>(client,
        `INSERT INTO operational_requests(
           organization_id, kind, subject_id, status, phase, message,
           idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          auth.organizationId,
          kind,
          body.subjectId,
          enabled ? "queued" : "not_configured",
          kind === "dds" ? "draft" : null,
          enabled ? null : `${kind} integration is disabled for this organization.`,
          idempotencyKey,
          auth.userId,
        ]);
      if (kind === "dds") {
        await client.query(
          `INSERT INTO review_requests(organization_id, subject_type, subject_id, requested_by)
           VALUES ($1, 'dds', $2, $3)`,
          [auth.organizationId, row!.id, auth.userId],
        );
      }
      await writeAudit(client, request, auth, `${kind}.create`, kind, row!.id, {
        subjectId: body.subjectId,
      });
      return { operation: row!, created: true };
    });
  }

  app.post("/api/v1/satellite/analyses", protectedRoute, async (request, reply) => {
    const { operation, created } = await createOperation(request, "satellite");
    if (created && operation.status === "queued") {
      const auth = authOf(request);
      const completed = await withContext(pool, auth, async (client) =>
        queryOne<OperationRow>(client,
          `UPDATE operational_requests
              SET status = 'completed', phase = 'screened',
                  metadata = jsonb_build_object(
                    'provider', 'safe-mock', 'risk', 'manual_review_required'
                  ),
                  message = 'Satellite screening completed; human review remains required.'
            WHERE id = $1 RETURNING *`,
          [operation.id]));
      return sendData(reply, operationJson(completed!), 202);
    }
    return sendData(reply, operationJson(operation), created ? 202 : 200);
  });

  app.post("/api/v1/evidence-packs", protectedRoute, async (request, reply) => {
    const { operation, created } = await createOperation(request, "evidence_pack");
    if (created && operation.status === "queued") {
      const auth = authOf(request);
      const packPath = path.resolve(config.STORAGE_DIR, "evidence", `${operation.id}.json`);
      await mkdir(path.dirname(packPath), { recursive: true });
      await writeFile(packPath, JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        organizationId: auth.organizationId,
        subjectId: operation.subject_id,
        notice: "Evidence packs support review and do not constitute legal advice.",
      }, null, 2), "utf8");
      const completed = await withContext(pool, auth, async (client) =>
        queryOne<OperationRow>(client,
          `UPDATE operational_requests
              SET status = 'completed', phase = 'generated',
                  download_url = $2, metadata = jsonb_build_object('storagePath', $3::text)
            WHERE id = $1 RETURNING *`,
          [
            operation.id,
            `${config.PUBLIC_BASE_URL}/api/v1/operations/${operation.id}/download`,
            `evidence/${operation.id}.json`,
          ]));
      return sendData(reply, operationJson(completed!), 202);
    }
    return sendData(reply, operationJson(operation), created ? 202 : 200);
  });

  app.post("/api/v1/dds/drafts", protectedRoute, async (request, reply) => {
    const { operation, created } = await createOperation(request, "dds");
    return sendData(reply, operationJson(operation), created ? 201 : 200);
  });

  app.post("/api/v1/dds/drafts/:id/validate", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (!["org_admin", "reviewer", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot validate DDS drafts.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { id } = parse(z.object({ id: uuidSchema }), request.params);
    const response = await withContext(pool, auth, async (client) => {
      await lockDdsActionKey(client, auth.organizationId!, idempotencyKey);
      const previous = await findDdsAction(client, auth.organizationId!, idempotencyKey);
      if (previous) {
        assertDdsActionBinding(previous, id, "validate");
        return replayDdsAction(previous);
      }
      const current = await loadOperation(client, auth.organizationId!, "dds", id, true);
      const action = await createDdsAction(
        client,
        auth.organizationId!,
        id,
        "validate",
        idempotencyKey,
        auth.userId,
      );
      try {
        await assertNoPendingGeofence(client, auth.organizationId!);
        const result = current.phase === "submitted"
          ? current
          : (await queryOne<OperationRow>(client,
            `UPDATE operational_requests
                SET status = 'completed', phase = 'validated',
                    message = 'DDS draft is structurally valid and awaits reviewer approval.'
              WHERE id = $1 RETURNING *`,
            [id]))!;
        const success: StoredDdsActionResponse = {
          ok: true,
          statusCode: 200,
          data: operationJson(result),
        };
        await completeDdsAction(client, action.id, "completed", success);
        await writeAudit(client, request, auth, "dds.validate", "dds", id, {
          idempotencyKey,
        });
        return success;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const failure = storedError(error);
        await completeDdsAction(client, action.id, "failed", failure, error.code);
        return failure;
      }
    });
    return sendStoredAction(reply, response);
  });

  app.post("/api/v1/dds/drafts/:id/submit", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (auth.role !== "org_admin") {
      throw new AppError(403, "FORBIDDEN", "Only an organization administrator may submit DDS drafts.");
    }
    const idempotencyKey = requireIdempotencyKey(request);
    const { id } = parse(z.object({ id: uuidSchema }), request.params);
    const prepared = await withContext(pool, auth, async (client) => {
      await lockDdsActionKey(client, auth.organizationId!, idempotencyKey);
      const previous = await findDdsAction(client, auth.organizationId!, idempotencyKey);
      if (previous) {
        assertDdsActionBinding(previous, id, "submit");
        return { response: replayDdsAction(previous) } as const;
      }
      const operation = await loadOperation(client, auth.organizationId!, "dds", id, true);
      const action = await createDdsAction(
        client,
        auth.organizationId!,
        id,
        "submit",
        idempotencyKey,
        auth.userId,
      );
      try {
        await assertNoPendingGeofence(client, auth.organizationId!);
        if (operation.phase === "submitted") {
          const success: StoredDdsActionResponse = {
            ok: true,
            statusCode: 200,
            data: operationJson(operation),
          };
          await completeDdsAction(client, action.id, "completed", success);
          return { response: success } as const;
        }
        if (operation.phase === "submitting" || operation.phase === "reconciliation_required") {
          throw conflict(
            "DDS_RECONCILIATION_REQUIRED",
            "A previous submission has no definitive result and must be reconciled by an administrator.",
          );
        }
        if (operation.phase !== "validated") {
          throw conflict("DDS_NOT_VALIDATED", "The DDS draft must be validated before submission.");
        }
        const review = await queryOne<{ status: string }>(client,
          `SELECT status FROM review_requests
            WHERE organization_id = $1 AND subject_type = 'dds' AND subject_id = $2`,
          [auth.organizationId, id]);
        if (review?.status !== "approved") {
          throw conflict("REVIEW_REQUIRED", "The DDS draft requires administrator or reviewer approval.");
        }
        const adapter = await queryOne<{
          eu_mode: "mock" | "live";
          eu_endpoint: string | null;
          eu_timeout_ms: number;
          eu_username_ciphertext: string | null;
          eu_password_ciphertext: string | null;
          eu_client_id_ciphertext: string | null;
        }>(client, "SELECT * FROM organization_api_config WHERE organization_id = $1", [auth.organizationId]);
        if (!adapter) throw conflict("EU_NOT_CONFIGURED", "EU adapter configuration is missing.");
        await client.query(
          `UPDATE operational_requests
              SET status = 'processing', phase = 'submitting',
                  message = 'DDS submission is in progress.'
            WHERE id = $1`,
          [id],
        );
        return {
          actionId: action.id,
          operation,
          adapter: {
            mode: adapter.eu_mode,
            endpoint: adapter.eu_endpoint,
            timeoutMs: adapter.eu_timeout_ms,
            usernameCiphertext: adapter.eu_username_ciphertext,
            passwordCiphertext: adapter.eu_password_ciphertext,
            clientIdCiphertext: adapter.eu_client_id_ciphertext,
          } satisfies EuAdapterConfig,
        } as const;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const failure = storedError(error);
        await completeDdsAction(client, action.id, "failed", failure, error.code);
        return { response: failure } as const;
      }
    });
    if ("response" in prepared) return sendStoredAction(reply, prepared.response);

    try {
      const submission = await submitDds(config, prepared.adapter, {
        id: prepared.operation.id,
        organizationId: auth.organizationId,
        subjectId: prepared.operation.subject_id,
      });
      const response = await withContext(pool, auth, async (client) => {
        const action = await queryOne<DdsActionRow>(client,
          `SELECT id, operation_id, action, idempotency_key, status, response
             FROM dds_actions WHERE id = $1 FOR UPDATE`,
          [prepared.actionId]);
        if (!action) throw notFound("DDS action");
        if (action.status !== "processing") return replayDdsAction(action);
        const row = await queryOne<OperationRow>(client,
          `UPDATE operational_requests
              SET status = 'completed', phase = 'submitted', external_reference = $2,
                  message = $3
            WHERE id = $1 RETURNING *`,
          [
            id,
            submission.reference,
            submission.mock ? "Submitted in safe mock mode." : "Submitted to EU EUDR V3.",
          ]);
        const success: StoredDdsActionResponse = {
          ok: true,
          statusCode: 200,
          data: operationJson(row!),
        };
        await completeDdsAction(client, action.id, "completed", success);
        await writeAudit(client, request, auth, "dds.submit", "dds", id, {
          mock: submission.mock,
          reference: submission.reference,
          idempotencyKey,
        });
        return success;
      });
      return sendStoredAction(reply, response);
    } catch (error) {
      const uncertain = !(error instanceof EuSubmissionError) || error.outcome === "uncertain";
      const appError = uncertain
        ? conflict(
          "DDS_RECONCILIATION_REQUIRED",
          "The EU submission result is uncertain and requires administrator reconciliation.",
        )
        : new AppError(
          502,
          "EU_SUBMISSION_FAILED",
          "The EU service definitively rejected the submission.",
        );
      const response = await withContext(pool, auth, async (client) => {
        const action = await queryOne<DdsActionRow>(client,
          `SELECT id, operation_id, action, idempotency_key, status, response
             FROM dds_actions WHERE id = $1 FOR UPDATE`,
          [prepared.actionId]);
        if (!action) throw notFound("DDS action");
        if (action.status !== "processing") return replayDdsAction(action);
        const failure = storedError(appError);
        await client.query(
          uncertain
            ? `UPDATE operational_requests
                  SET status = 'failed', phase = 'reconciliation_required',
                      message = 'Submission outcome is uncertain; administrator reconciliation is required.'
                WHERE id = $1`
            : `UPDATE operational_requests
                  SET status = 'completed', phase = 'validated',
                      message = 'EU submission failed definitively and may be retried with a new idempotency key.'
                WHERE id = $1`,
          [id],
        );
        await completeDdsAction(
          client,
          action.id,
          uncertain ? "uncertain" : "failed",
          failure,
          appError.code,
        );
        await writeAudit(
          client,
          request,
          auth,
          uncertain ? "dds.submit.uncertain" : "dds.submit.failed",
          "dds",
          id,
          { idempotencyKey },
        );
        return failure;
      });
      request.log.error({ err: error, operationId: id }, "EU DDS submission failed");
      return sendStoredAction(reply, response);
    }
  });

  const getRoutes: Array<{ path: string; kind: OperationKind }> = [
    { path: "/api/v1/satellite/analyses/:id", kind: "satellite" },
    { path: "/api/v1/evidence-packs/:id", kind: "evidence_pack" },
    { path: "/api/v1/dds/drafts/:id", kind: "dds" },
  ];
  for (const route of getRoutes) {
    app.get(route.path, protectedRoute, async (request, reply) => {
      const auth = authOf(request);
      if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
      const { id } = parse(z.object({ id: uuidSchema }), request.params);
      const operation = await withContext(pool, auth, (client) =>
        loadOperation(client, auth.organizationId!, route.kind, id));
      return sendData(reply, operationJson(operation));
    });
  }

  app.get("/api/v1/operations/:id/download", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    const { id } = parse(z.object({ id: uuidSchema }), request.params);
    const operation = await withContext(pool, auth, (client) =>
      queryOne<OperationRow>(client,
        `SELECT * FROM operational_requests
          WHERE id = $1 AND organization_id = $2 AND kind = 'evidence_pack' AND status = 'completed'`,
        [id, auth.organizationId]));
    if (!operation) throw notFound("Evidence pack");
    const storagePath = operation.metadata.storagePath;
    if (typeof storagePath !== "string" || !storagePath.startsWith("evidence/")) throw notFound("Evidence pack");
    const filePath = path.resolve(config.STORAGE_DIR, storagePath);
    const evidenceRoot = `${path.resolve(config.STORAGE_DIR, "evidence")}${path.sep}`;
    if (!filePath.startsWith(evidenceRoot)) throw notFound("Evidence pack");
    const bytes = await readFile(filePath);
    return reply
      .header("Content-Type", "application/json")
      .header("Content-Disposition", `attachment; filename="evidence-pack-${id}.json"`)
      .send(bytes);
  });
}
