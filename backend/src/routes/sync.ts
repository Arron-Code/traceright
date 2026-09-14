import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { AppError, conflict } from "../errors.js";
import { geometryHash, parsePolygon } from "../geo.js";
import { authOf, parse, sendData } from "../http.js";
import type { GeoJsonPolygon } from "../types.js";

const supplierPayload = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  region: z.string().max(200),
  producerCount: z.number().int().min(0),
  plotCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
}).passthrough();
const plotPayload = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  producer: z.string().trim().min(1).max(200),
  farmName: z.string().trim().min(1).max(200),
  areaHa: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  polygon: z.unknown(),
  capturedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).passthrough();
const operationBase = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  entityId: z.string().uuid(),
  action: z.literal("upsert"),
  createdAt: z.string().datetime(),
});
const pushSchema = z.object({
  deviceId: z.string().min(1).max(200),
  operations: z.array(z.discriminatedUnion("entityType", [
    operationBase.extend({ entityType: z.literal("supplier"), payload: supplierPayload }),
    operationBase.extend({ entityType: z.literal("plot"), payload: plotPayload }),
  ])).max(500),
});
type PushOperation = z.infer<typeof pushSchema>["operations"][number];
export type GeofenceEvaluation = {
  geofenceStatus: "pending" | "inside" | "review_required" | "approved";
  localGeofenceResult: "pending" | "inside" | "outside";
};
type GeofenceCheckResult = GeofenceEvaluation & { violationId: string | null };
type GeofenceViolationDetail = {
  violationId: string;
  operationId: string;
  entityId: string;
};

export function classifyGeofenceResult(check: {
  geofencesExist: boolean;
  covered: boolean;
  approved: boolean;
}): GeofenceEvaluation {
  if (!check.geofencesExist) {
    return { geofenceStatus: "pending", localGeofenceResult: "pending" };
  }
  if (check.covered) {
    return { geofenceStatus: "inside", localGeofenceResult: "inside" };
  }
  if (check.approved) {
    return { geofenceStatus: "approved", localGeofenceResult: "outside" };
  }
  return { geofenceStatus: "review_required", localGeofenceResult: "outside" };
}

function supplierJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    producerCount: row.producer_count,
    plotCount: row.plot_count,
    updatedAt: row.source_updated_at instanceof Date
      ? row.source_updated_at.toISOString()
      : row.source_updated_at,
    syncStatus: "synced",
  };
}

export function plotJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    ...(row.supplier_id ? { supplierId: row.supplier_id } : {}),
    producer: row.producer,
    farmName: row.farm_name,
    areaHa: String(row.area_ha),
    polygon: row.polygon,
    geofenceStatus: row.geofence_status,
    localGeofenceResult: row.local_geofence_result,
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at,
    updatedAt: row.source_updated_at instanceof Date
      ? row.source_updated_at.toISOString()
      : row.source_updated_at,
    syncStatus: "synced",
  };
}

async function checkGeofence(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "plot" }>,
  polygon: GeoJsonPolygon,
): Promise<GeofenceCheckResult> {
  const hash = geometryHash(polygon);
  const check = await queryOne<{ geofences_exist: boolean; covered: boolean; approved: boolean }>(
    client,
    `SELECT
       EXISTS(SELECT 1 FROM geofences WHERE organization_id = $1 AND active) AS geofences_exist,
       EXISTS(
         SELECT 1 FROM geofences
          WHERE organization_id = $1 AND active
            AND ST_Covers(polygon, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
       ) AS covered,
       EXISTS(
         SELECT 1 FROM geofence_violations
          WHERE organization_id = $1 AND entity_type = 'plot'
            AND entity_id = $3 AND payload_hash = $4
            AND status = 'approved'
       ) AS approved`,
    [organizationId, JSON.stringify(polygon), operation.entityId, hash],
  );
  const evaluation = classifyGeofenceResult({
    geofencesExist: Boolean(check?.geofences_exist),
    covered: Boolean(check?.covered),
    approved: Boolean(check?.approved),
  });
  if (evaluation.geofenceStatus !== "review_required") {
    return { ...evaluation, violationId: null };
  }
  const violation = await queryOne<{ id: string }>(client,
    `INSERT INTO geofence_violations(
       organization_id, entity_type, entity_id, payload_hash, geometry, reason
     ) VALUES (
       $1, 'plot', $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
       'Plot is outside all active organization geofences'
     )
     ON CONFLICT (organization_id, entity_type, entity_id, payload_hash)
     DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id`,
    [organizationId, operation.entityId, hash, JSON.stringify(polygon)]);
  return { ...evaluation, violationId: violation!.id };
}

async function applySupplier(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "supplier" }>,
) {
  const existing = await queryOne<Record<string, unknown>>(client,
    "SELECT * FROM suppliers WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [organizationId, operation.entityId]);
  if (
    existing &&
    new Date(existing.source_updated_at as string | Date).getTime() >
      new Date(operation.payload.updatedAt).getTime()
  ) {
    return { conflict: supplierJson(existing) };
  }
  const row = await queryOne<Record<string, unknown>>(client,
    `INSERT INTO suppliers(
       id, organization_id, name, region, producer_count, plot_count, source_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (organization_id, id) DO UPDATE SET
       name = EXCLUDED.name, region = EXCLUDED.region,
       producer_count = EXCLUDED.producer_count, plot_count = EXCLUDED.plot_count,
       source_updated_at = EXCLUDED.source_updated_at
     RETURNING *`,
    [
      operation.entityId,
      organizationId,
      operation.payload.name,
      operation.payload.region,
      operation.payload.producerCount,
      operation.payload.plotCount,
      operation.payload.updatedAt,
    ]);
  const payload = supplierJson(row!);
  await client.query(
    "INSERT INTO sync_changes(organization_id, entity_type, entity_id, payload) VALUES ($1, 'supplier', $2, $3::jsonb)",
    [organizationId, operation.entityId, JSON.stringify(payload)],
  );
  return { payload };
}

async function applyPlot(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "plot" }>,
  polygon: GeoJsonPolygon,
  geofence: GeofenceEvaluation,
) {
  const existing = await queryOne<Record<string, unknown>>(client,
    `SELECT *, ST_AsGeoJSON(polygon)::jsonb AS polygon
       FROM plots WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [organizationId, operation.entityId]);
  if (
    existing &&
    new Date(existing.source_updated_at as string | Date).getTime() >
      new Date(operation.payload.updatedAt).getTime()
  ) {
    return { conflict: plotJson(existing) };
  }
  const row = await queryOne<Record<string, unknown>>(client,
    `INSERT INTO plots(
       id, organization_id, supplier_id, producer, farm_name, area_ha,
       polygon, geofence_status, local_geofence_result, captured_at, source_updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $8, $9, $10, $11
     )
     ON CONFLICT (organization_id, id) DO UPDATE SET
       supplier_id = EXCLUDED.supplier_id, producer = EXCLUDED.producer,
       farm_name = EXCLUDED.farm_name, area_ha = EXCLUDED.area_ha,
       polygon = EXCLUDED.polygon, geofence_status = EXCLUDED.geofence_status,
       local_geofence_result = EXCLUDED.local_geofence_result,
       captured_at = EXCLUDED.captured_at,
       source_updated_at = EXCLUDED.source_updated_at
     RETURNING *, ST_AsGeoJSON(polygon)::jsonb AS polygon`,
    [
      operation.entityId,
      organizationId,
      operation.payload.supplierId ?? null,
      operation.payload.producer,
      operation.payload.farmName,
      operation.payload.areaHa,
      JSON.stringify(polygon),
      geofence.geofenceStatus,
      geofence.localGeofenceResult,
      operation.payload.capturedAt,
      operation.payload.updatedAt,
    ]);
  const payload = plotJson(row!);
  await client.query(
    "INSERT INTO sync_changes(organization_id, entity_type, entity_id, payload) VALUES ($1, 'plot', $2, $3::jsonb)",
    [organizationId, operation.entityId, JSON.stringify(payload)],
  );
  return { payload };
}

export async function registerSyncRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  const protectedRoute = { preHandler: authenticate };

  app.get("/api/v1/geofences", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw forbiddenSystemUser();
    const geofences = await withContext(pool, auth, (client) =>
      queryMany(client,
        `SELECT id, organization_id AS "organizationId", name,
                ST_AsGeoJSON(polygon)::jsonb AS polygon,
                updated_at AS "updatedAt"
           FROM geofences
          WHERE organization_id = $1 AND active = true
          ORDER BY name`,
        [auth.organizationId]));
    return sendData(reply, geofences);
  });

  app.post("/api/v1/sync/push", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw forbiddenSystemUser();
    if (!["org_admin", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot push mobile changes.");
    }
    const body = parse(pushSchema, request.body);
    const parsedPolygons = new Map<string, GeoJsonPolygon>();
    for (const operation of body.operations) {
      if (operation.entityId !== operation.payload.id) {
        throw conflict("ENTITY_ID_MISMATCH", "Operation entityId must equal payload.id.");
      }
      if (operation.entityType === "plot") {
        parsedPolygons.set(operation.id, parsePolygon(operation.payload.polygon));
      }
    }

    const geofenceEvaluations = new Map<string, GeofenceEvaluation>();
    const violations = await withContext(pool, auth, async (client) => {
      const details: GeofenceViolationDetail[] = [];
      for (const operation of body.operations) {
        if (operation.entityType !== "plot") continue;
        const evaluation = await checkGeofence(
          client,
          auth.organizationId!,
          operation,
          parsedPolygons.get(operation.id)!,
        );
        geofenceEvaluations.set(operation.id, evaluation);
        if (evaluation.violationId) {
          details.push({
            violationId: evaluation.violationId,
            operationId: operation.id,
            entityId: operation.entityId,
          });
        }
      }
      if (details.length) {
        await writeAudit(client, request, auth, "sync.blocked.geofence", "sync", body.deviceId, {
          violations: details,
        });
      }
      return details;
    });
    if (violations.length) {
      throw conflict(
        "GEOFENCE_REVIEW_REQUIRED",
        "Sync is blocked until an administrator reviews the geofence violation.",
        { violations },
      );
    }

    const result = await withContext(pool, auth, async (client) => {
      const accepted: string[] = [];
      const conflicts: Array<Record<string, unknown>> = [];
      const ordered = [...body.operations].sort((left, right) =>
        left.entityType === right.entityType ? 0 : left.entityType === "supplier" ? -1 : 1);
      for (const operation of ordered) {
        const previous = await queryOne<{
          operation_id: string;
          response: { accepted?: boolean; remote?: unknown };
        }>(
          client,
          `SELECT operation_id, response FROM sync_operations
            WHERE organization_id = $1 AND idempotency_key = $2`,
          [auth.organizationId, operation.idempotencyKey],
        );
        if (previous) {
          if (previous.operation_id !== operation.id) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "An idempotency key cannot be reused for a different operation.",
            );
          }
          if (previous.response.accepted) accepted.push(operation.id);
          else conflicts.push({
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            remote: previous.response.remote,
          });
          continue;
        }
        const applied = operation.entityType === "supplier"
          ? await applySupplier(client, auth.organizationId!, operation)
          : await applyPlot(
            client,
            auth.organizationId!,
            operation,
            parsedPolygons.get(operation.id)!,
            geofenceEvaluations.get(operation.id)!,
          );
        if (applied.conflict) {
          conflicts.push({
            operationId: operation.id,
            entityType: operation.entityType,
            entityId: operation.entityId,
            remote: applied.conflict,
          });
        } else {
          accepted.push(operation.id);
        }
        await client.query(
          `INSERT INTO sync_operations(
             organization_id, idempotency_key, operation_id, response
           ) VALUES ($1, $2, $3, $4::jsonb)`,
          [
            auth.organizationId,
            operation.idempotencyKey,
            operation.id,
            JSON.stringify(applied.conflict
              ? { accepted: false, remote: applied.conflict }
              : { accepted: true }),
          ],
        );
      }
      await writeAudit(client, request, auth, "sync.push", "device", body.deviceId, {
        accepted: accepted.length,
        conflicts: conflicts.length,
      });
      return { accepted, ...(conflicts.length ? { conflicts } : {}) };
    });
    return sendData(reply, result);
  });

  app.get("/api/v1/sync/pull", protectedRoute, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw forbiddenSystemUser();
    const query = parse(z.object({
      cursor: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }), request.query);
    const changes = await withContext(pool, auth, (client) =>
      queryMany<{ sequence_id: number; entity_type: "supplier" | "plot"; payload: unknown }>(
        client,
        `SELECT sequence_id, entity_type, payload
           FROM sync_changes
          WHERE organization_id = $1 AND sequence_id > $2
          ORDER BY sequence_id LIMIT $3`,
        [auth.organizationId, query.cursor, query.limit],
      ));
    const cursor = changes.length ? String(changes[changes.length - 1]!.sequence_id) : String(query.cursor);
    return sendData(reply, {
      cursor,
      changes: changes.map((change) => ({
        entityType: change.entity_type,
        entity: change.payload,
      })),
    });
  });
}

function forbiddenSystemUser() {
  return new AppError(403, "ORGANIZATION_REQUIRED", "This endpoint requires an organization-scoped account.");
}
