import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PoolClient } from "pg";
import { AppError } from "../src/errors.js";
import { establishMigrationSystemContext } from "../src/migration-context.js";
import {
  assertDdsActionBinding,
  replayDdsAction,
  type StoredDdsActionResponse,
} from "../src/routes/operations.js";
import { classifyGeofenceResult, plotJson } from "../src/routes/sync.js";

test("approved geofence exceptions produce authoritative mobile plot fields", () => {
  assert.deepEqual(
    classifyGeofenceResult({ geofencesExist: true, covered: false, approved: false }),
    { geofenceStatus: "review_required", localGeofenceResult: "outside" },
  );
  assert.deepEqual(
    classifyGeofenceResult({ geofencesExist: true, covered: false, approved: true }),
    { geofenceStatus: "approved", localGeofenceResult: "outside" },
  );
  const serialized = plotJson({
    id: "plot-1",
    producer: "Producer",
    farm_name: "Farm",
    area_ha: 1.5,
    polygon: { type: "Polygon", coordinates: [] },
    geofence_status: "approved",
    local_geofence_result: "outside",
    captured_at: new Date("2025-01-02T03:04:05.000Z"),
    source_updated_at: new Date("2025-01-03T03:04:05.000Z"),
  });
  assert.equal(serialized.geofenceStatus, "approved");
  assert.equal(serialized.localGeofenceResult, "outside");
});

test("DDS idempotency keys are bound to one operation and action", () => {
  assert.doesNotThrow(() =>
    assertDdsActionBinding({ operation_id: "dds-1", action: "submit" }, "dds-1", "submit"));
  for (const [operationId, action] of [["dds-2", "submit"], ["dds-1", "validate"]] as const) {
    assert.throws(
      () => assertDdsActionBinding(
        { operation_id: "dds-1", action: "submit" },
        operationId,
        action,
      ),
      (error) => error instanceof AppError && error.code === "IDEMPOTENCY_KEY_REUSED",
    );
  }
});

test("DDS action replay returns stored results and never retries ambiguous actions", () => {
  const stored: StoredDdsActionResponse = {
    ok: false,
    statusCode: 409,
    error: { code: "KNOWN_RESULT", message: "Stored response" },
  };
  assert.deepEqual(replayDdsAction({ status: "failed", response: stored }), stored);
  assert.deepEqual(
    replayDdsAction({ status: "processing", response: null }),
    {
      ok: false,
      statusCode: 409,
      error: {
        code: "DDS_ACTION_PROCESSING",
        message: "This DDS action is already processing and will not be submitted again.",
      },
    },
  );
  assert.equal(
    replayDdsAction({ status: "uncertain", response: null }).ok,
    false,
  );
  const uncertain = replayDdsAction({ status: "uncertain", response: null });
  assert.equal(uncertain.ok ? "" : uncertain.error.code, "DDS_RECONCILIATION_REQUIRED");
});

test("migration runner establishes system RLS context before migration queries", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push(values ? { text, values } : { text });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  await establishMigrationSystemContext(client);
  assert.deepEqual(calls, [
    {
      text: "SELECT set_config('app.is_system_admin', 'true', false), set_config('app.current_organization', '', false)",
    },
  ]);
});

test("DDS action migration defines durable tenant-scoped persistence", async () => {
  const sql = await readFile(new URL("../migrations/003_dds_idempotency_and_plot_geofence.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE dds_actions/);
  assert.match(sql, /UNIQUE \(organization_id, idempotency_key\)/);
  assert.match(sql, /status IN \('processing', 'completed', 'failed', 'uncertain'\)/);
  assert.match(sql, /ALTER TABLE dds_actions FORCE ROW LEVEL SECURITY/);
});
