import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { signAccessToken } from "../src/security.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
const plotId = "1db48d88-b22f-42db-8d9d-20bcb14c0f27";
const operationId = "0cf63e4f-f37b-4505-9d28-eb06cfa8c72a";
const secondPlotId = "8b3da65c-2793-4976-a3ed-d82460cfa36a";
const secondOperationId = "d0224a2a-6e7a-4627-a48f-b8f8179349ea";
const violationByEntity = {
  [plotId]: "17983aa4-3460-4c40-b9ac-f28cad3bb2e5",
  [secondPlotId]: "395a05aa-b070-4a79-80b0-29ceacd39f18",
};
const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4300,
  DATABASE_URL: "postgres://unused",
  DATABASE_SSL: false,
  JWT_SECRET: "a-secret-that-is-at-least-thirty-two-bytes-long",
  JWT_ISSUER: "test",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  CONFIG_ENCRYPTION_KEY: randomBytes(32),
  PUBLIC_BASE_URL: "http://127.0.0.1:4300",
  STORAGE_DIR: "storage",
  ADMIN_ORIGIN: "http://127.0.0.1:4300",
};

function fakeGeofenceRetryPool() {
  let approved = false;
  const pulledPayloads: Record<string, unknown>[] = [];
  const empty = { rows: [], rowCount: 0 } as unknown as QueryResult;
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      if (text.includes("FROM users WHERE id")) {
        return {
          rows: [{
            active: true,
            token_version: 0,
            organization_id: organizationId,
            role: "field_agent",
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("AS geofences_exist")) {
        assert.equal(values[0], organizationId);
        assert.match(text, /organization_id = \$1/);
        assert.match(text, /entity_type = 'plot'/);
        return {
          rows: [{ geofences_exist: true, covered: false, approved }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("INSERT INTO geofence_violations")) {
        assert.equal(values[0], organizationId);
        const violationId = violationByEntity[String(values[1]) as keyof typeof violationByEntity];
        assert.ok(violationId, "violation must be created for the current batch entity");
        return {
          rows: [{ id: violationId }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("FROM sync_operations")) return empty;
      if (text.includes("FROM plots WHERE")) return empty;
      if (text.includes("INSERT INTO plots")) {
        return {
          rows: [{
            id: values[0],
            supplier_id: values[2],
            producer: values[3],
            farm_name: values[4],
            area_ha: values[5],
            polygon: JSON.parse(String(values[6])),
            geofence_status: values[7],
            local_geofence_result: values[8],
            captured_at: new Date(String(values[9])),
            source_updated_at: new Date(String(values[10])),
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("INSERT INTO sync_changes")) {
        pulledPayloads.push(JSON.parse(String(values[2])));
        return empty;
      }
      if (text.includes("FROM sync_changes")) {
        return {
          rows: pulledPayloads.map((payload, index) => ({
            sequence_id: index + 1,
            entity_type: "plot",
            payload,
          })),
          rowCount: pulledPayloads.length,
        } as QueryResult;
      }
      return empty;
    },
    release() {},
  } as unknown as PoolClient;
  return {
    pool: { connect: async () => client } as unknown as Pool,
    approve: () => { approved = true; },
  };
}

test("the identical geofence-blocked sync retry is accepted after approval and pulled as approved", async () => {
  const fake = fakeGeofenceRetryPool();
  const app = await buildApp(config, fake.pool);
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId,
    role: "field_agent",
    tokenVersion: 0,
  });
  const payload = {
    deviceId: "field-device-1",
    operations: [{
      id: operationId,
      idempotencyKey: "plot-retry-key-1",
      entityId: plotId,
      entityType: "plot",
      action: "upsert",
      createdAt: "2026-09-14T20:00:00.000Z",
      payload: {
        id: plotId,
        producer: "Producer",
        farmName: "Outside farm",
        areaHa: "1.5",
        polygon: {
          type: "Polygon",
          coordinates: [[[8, 50], [9, 50], [9, 51], [8, 50]]],
        },
        capturedAt: "2026-09-14T20:00:00.000Z",
        updatedAt: "2026-09-14T20:00:00.000Z",
      },
    }, {
      id: secondOperationId,
      idempotencyKey: "plot-retry-key-2",
      entityId: secondPlotId,
      entityType: "plot",
      action: "upsert",
      createdAt: "2026-09-14T20:01:00.000Z",
      payload: {
        id: secondPlotId,
        producer: "Second Producer",
        farmName: "Second outside farm",
        areaHa: "2.5",
        polygon: {
          type: "Polygon",
          coordinates: [[[10, 52], [11, 52], [11, 53], [10, 52]]],
        },
        capturedAt: "2026-09-14T20:01:00.000Z",
        updatedAt: "2026-09-14T20:01:00.000Z",
      },
    }],
  };
  try {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, "GEOFENCE_REVIEW_REQUIRED");
    assert.deepEqual(blocked.json().error.details, {
      violations: [{
        violationId: violationByEntity[plotId],
        operationId,
        entityId: plotId,
      }, {
        violationId: violationByEntity[secondPlotId],
        operationId: secondOperationId,
        entityId: secondPlotId,
      }],
    });

    fake.approve();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/sync/push",
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.json().data.accepted, [operationId, secondOperationId]);

    const pulled = await app.inject({
      method: "GET",
      url: "/api/v1/sync/pull?cursor=0",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(pulled.statusCode, 200);
    assert.equal(pulled.json().data.changes.length, 2);
    for (const change of pulled.json().data.changes) {
      assert.equal(change.entity.geofenceStatus, "approved");
      assert.equal(change.entity.localGeofenceResult, "outside");
    }
  } finally {
    await app.close();
  }
});
