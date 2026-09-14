import assert from "node:assert/strict";
import test from "node:test";
import { configureApiSession } from "./api";
import {
  closePolygon,
  type AuthSession,
  type OutboxOperation,
  type PersistedState,
  type Plot,
  type Supplier,
} from "./domain";
import { synchronize } from "./sync";

const expectedScope = { userId: "user-1", organizationId: "org-1" };

function configureTestSession() {
  configureApiSession({
    accessToken: "access",
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    refreshToken: "refresh",
    user: { id: "user-1", email: "field@example.com" },
    organizations: [{ id: "org-1", name: "Organization" }],
    selectedOrganizationId: "org-1",
  } satisfies AuthSession, () => undefined);
}

test("structured geofence review pauses only the outside plot and pushes the remaining batch", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  configureTestSession();

  const now = new Date().toISOString();
  const polygon = closePolygon([[7, 50], [8, 50], [8, 51]]);
  const supplier: Supplier = {
    id: "supplier-1",
    name: "Supplier",
    region: "Region",
    producerCount: 1,
    plotCount: 2,
    updatedAt: now,
    syncStatus: "pending",
  };
  const insidePlot: Plot = {
    id: "plot-inside",
    producer: "Inside",
    farmName: "Inside farm",
    areaHa: "1.00",
    polygon,
    geofenceStatus: "inside",
    localGeofenceResult: "inside",
    capturedAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  const outsidePlot: Plot = {
    ...insidePlot,
    id: "plot-outside",
    producer: "Outside",
    farmName: "Outside farm",
    geofenceStatus: "outside",
    localGeofenceResult: "outside",
  };
  const operations: OutboxOperation[] = [
    {
      id: "supplier-operation",
      idempotencyKey: "supplier-key",
      entityType: "supplier",
      entityId: supplier.id,
      action: "upsert",
      payload: supplier,
      createdAt: now,
      attempts: 0,
    },
    {
      id: "inside-operation",
      idempotencyKey: "inside-key",
      entityType: "plot",
      entityId: insidePlot.id,
      action: "upsert",
      payload: insidePlot,
      createdAt: now,
      attempts: 0,
    },
    {
      id: "outside-operation",
      idempotencyKey: "outside-key",
      entityType: "plot",
      entityId: outsidePlot.id,
      action: "upsert",
      payload: outsidePlot,
      createdAt: now,
      attempts: 0,
    },
  ];
  const pushedOperationIds: string[][] = [];
  let pushAttempt = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/sync/push")) {
      const body = JSON.parse(String(init?.body)) as { operations: OutboxOperation[] };
      pushedOperationIds.push(body.operations.map(({ id }) => id));
      pushAttempt += 1;
      if (pushAttempt === 1) {
        return Response.json({
          error: {
            code: "GEOFENCE_REVIEW_REQUIRED",
            message: "Administrative review is required.",
            details: {
              violations: [{
                violationId: "violation-1",
                operationId: "outside-operation",
                entityId: "plot-outside",
              }],
            },
          },
        }, { status: 409 });
      }
      return Response.json({
        data: { accepted: body.operations.map(({ id }) => id) },
      });
    }
    return Response.json({
      data: { cursor: `cursor-${pushAttempt}`, changes: [] },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  const initial: PersistedState = {
    version: 3,
    deviceId: "device-1",
    cursor: null,
    suppliers: [supplier],
    plots: [insidePlot, outsidePlot],
    documents: [],
    operations: [],
    outbox: operations,
    conflicts: [],
    geofences: [],
    lastSyncAt: null,
  };
  const reviewed = await synchronize(initial, true, expectedScope);

  assert.deepEqual(pushedOperationIds[0], [
    "supplier-operation",
    "inside-operation",
    "outside-operation",
  ]);
  assert.deepEqual(pushedOperationIds[1], ["supplier-operation", "inside-operation"]);
  assert.equal(reviewed.state.suppliers[0].syncStatus, "synced");
  assert.equal(reviewed.state.plots.find(({ id }) => id === insidePlot.id)?.syncStatus, "synced");
  assert.equal(
    reviewed.state.plots.find(({ id }) => id === outsidePlot.id)?.geofenceStatus,
    "review_required",
  );
  assert.equal(reviewed.state.outbox.length, 1);
  assert.equal(reviewed.state.outbox[0].id, "outside-operation");
  assert.equal(reviewed.state.outbox[0].idempotencyKey, "outside-key");
  assert.equal(reviewed.state.outbox[0].geofenceViolationId, "violation-1");
  assert.equal(reviewed.state.cursor, "cursor-2");

  const approved = await synchronize(reviewed.state, true, expectedScope);

  assert.equal(approved.state.outbox.length, 0);
  assert.deepEqual(pushedOperationIds[2], ["outside-operation"]);
});

test("invalid geofence review details leave the batch and plots unchanged", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://mobile.test";
  configureTestSession();
  const now = new Date().toISOString();
  const plot: Plot = {
    id: "plot-outside",
    producer: "Producer",
    farmName: "Farm",
    areaHa: "1.00",
    polygon: closePolygon([[7, 50], [8, 50], [8, 51]]),
    geofenceStatus: "outside",
    localGeofenceResult: "outside",
    capturedAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  const operation: OutboxOperation = {
    id: "outside-operation",
    idempotencyKey: "outside-key",
    entityType: "plot",
    entityId: plot.id,
    action: "upsert",
    payload: plot,
    createdAt: now,
    attempts: 0,
  };

  globalThis.fetch = async (input) =>
    String(input).endsWith("/api/v1/sync/push")
      ? Response.json({
          error: {
            code: "GEOFENCE_REVIEW_REQUIRED",
            message: "Review required.",
            details: { violations: [{ operationId: operation.id }] },
          },
        }, { status: 409 })
      : Response.json({ data: { cursor: "cursor-1", changes: [] } });

  t.after(() => {
    globalThis.fetch = originalFetch;
    configureApiSession(null, () => undefined);
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  const initial: PersistedState = {
    version: 3,
    deviceId: "device-1",
    cursor: null,
    suppliers: [],
    plots: [plot],
    documents: [],
    operations: [],
    outbox: [operation],
    conflicts: [],
    geofences: [],
    lastSyncAt: null,
  };
  const result = await synchronize(initial, true, expectedScope);

  assert.deepEqual(result.state.outbox, [operation]);
  assert.equal(result.state.plots[0].geofenceStatus, "outside");
  assert.equal(result.state.cursor, "cursor-1");
});
