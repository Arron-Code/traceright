import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { signAccessToken } from "../src/security.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
const ddsId = "1db48d88-b22f-42db-8d9d-20bcb14c0f27";
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

function fakeDdsPool() {
  const operation = {
    id: ddsId,
    organization_id: organizationId,
    kind: "dds",
    subject_id: "shipment-1",
    status: "queued",
    phase: "draft",
    download_url: null,
    message: null,
    metadata: {},
    external_reference: null,
    updated_at: new Date("2026-09-14T20:00:00.000Z"),
  };
  let action: Record<string, unknown> | null = null;
  let operationUpdates = 0;
  const empty = { rows: [], rowCount: 0 } as unknown as QueryResult;
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      if (text.includes("FROM users WHERE id")) {
        return {
          rows: [{
            active: true,
            token_version: 0,
            organization_id: organizationId,
            role: "org_admin",
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("FROM dds_actions") && text.includes("idempotency_key")) {
        return {
          rows: action ? [action] : [],
          rowCount: action ? 1 : 0,
        } as QueryResult;
      }
      if (text.includes("FROM operational_requests") && text.includes("kind = $3")) {
        return { rows: [operation], rowCount: 1 } as QueryResult;
      }
      if (text.includes("INSERT INTO dds_actions")) {
        action = {
          id: "17983aa4-3460-4c40-b9ac-f28cad3bb2e5",
          operation_id: ddsId,
          action: values[2],
          idempotency_key: values[3],
          status: "processing",
          response: null,
        };
        return { rows: [action], rowCount: 1 } as QueryResult;
      }
      if (text.includes("FROM geofence_violations")) {
        return { rows: [{ count: 0 }], rowCount: 1 } as QueryResult;
      }
      if (text.includes("UPDATE operational_requests")) {
        operationUpdates += 1;
        Object.assign(operation, {
          status: "completed",
          phase: "validated",
          message: "DDS draft is structurally valid and awaits reviewer approval.",
        });
        return { rows: [operation], rowCount: 1 } as QueryResult;
      }
      if (text.includes("UPDATE dds_actions")) {
        Object.assign(action!, {
          status: values[1],
          response: JSON.parse(String(values[2])),
        });
        return empty;
      }
      return empty;
    },
    release() {},
  } as unknown as PoolClient;
  return {
    pool: { connect: async () => client } as unknown as Pool,
    operationUpdates: () => operationUpdates,
  };
}

test("DDS validate replays its persisted response and rejects cross-action key reuse", async () => {
  const fake = fakeDdsPool();
  const app = await buildApp(config, fake.pool);
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId,
    role: "org_admin",
    tokenVersion: 0,
  });
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "idempotency-key": "durable-dds-key-1",
  };
  try {
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/dds/drafts/${ddsId}/validate`,
      headers,
    });
    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/dds/drafts/${ddsId}/validate`,
      headers,
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(repeated.json(), first.json());
    assert.equal(fake.operationUpdates(), 1);

    const crossAction = await app.inject({
      method: "POST",
      url: `/api/v1/dds/drafts/${ddsId}/submit`,
      headers,
    });
    assert.equal(crossAction.statusCode, 409);
    assert.equal(crossAction.json().error.code, "IDEMPOTENCY_KEY_REUSED");
  } finally {
    await app.close();
  }
});

function fakeUncertainSubmitPool() {
  const operation = {
    id: ddsId,
    organization_id: organizationId,
    kind: "dds",
    subject_id: "shipment-1",
    status: "completed",
    phase: "validated",
    download_url: null,
    message: null,
    metadata: {},
    external_reference: null,
    updated_at: new Date("2026-09-14T20:00:00.000Z"),
  };
  let action: Record<string, unknown> | null = null;
  const empty = { rows: [], rowCount: 0 } as unknown as QueryResult;
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      if (text.includes("FROM users WHERE id")) {
        return {
          rows: [{
            active: true,
            token_version: 0,
            organization_id: organizationId,
            role: "org_admin",
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("FROM dds_actions")) {
        const found = values.length === 1 || values[1] === "uncertain-submit-key"
          ? action
          : null;
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 } as QueryResult;
      }
      if (text.includes("FROM operational_requests") && text.includes("kind = $3")) {
        return { rows: [operation], rowCount: 1 } as QueryResult;
      }
      if (text.includes("INSERT INTO dds_actions")) {
        action = {
          id: "17983aa4-3460-4c40-b9ac-f28cad3bb2e5",
          operation_id: ddsId,
          action: "submit",
          idempotency_key: values[3],
          status: "processing",
          response: null,
        };
        return { rows: [action], rowCount: 1 } as QueryResult;
      }
      if (text.includes("FROM geofence_violations")) {
        return { rows: [{ count: 0 }], rowCount: 1 } as QueryResult;
      }
      if (text.includes("FROM review_requests")) {
        return { rows: [{ status: "approved" }], rowCount: 1 } as QueryResult;
      }
      if (text.includes("FROM organization_api_config")) {
        return {
          rows: [{
            eu_mode: "live",
            eu_endpoint: "https://8.8.8.8/eudr",
            eu_timeout_ms: 1000,
            eu_username_ciphertext: null,
            eu_password_ciphertext: null,
            eu_client_id_ciphertext: null,
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("UPDATE operational_requests")) {
        if (text.includes("reconciliation_required")) {
          Object.assign(operation, { status: "failed", phase: "reconciliation_required" });
        } else {
          Object.assign(operation, { status: "processing", phase: "submitting" });
        }
        return empty;
      }
      if (text.includes("UPDATE dds_actions")) {
        Object.assign(action!, {
          status: values[1],
          response: JSON.parse(String(values[2])),
        });
        return empty;
      }
      return empty;
    },
    release() {},
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

test("an uncertain DDS submit is persisted and the same key never calls SOAP twice", async () => {
  const app = await buildApp(config, fakeUncertainSubmitPool());
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId,
    role: "org_admin",
    tokenVersion: 0,
  });
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "idempotency-key": "uncertain-submit-key",
  };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("connection ended after write");
  };
  try {
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/dds/drafts/${ddsId}/submit`,
      headers,
    });
    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/dds/drafts/${ddsId}/submit`,
      headers,
    });
    assert.equal(first.statusCode, 409);
    assert.equal(first.json().error.code, "DDS_RECONCILIATION_REQUIRED");
    assert.deepEqual(repeated.json(), first.json());
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
