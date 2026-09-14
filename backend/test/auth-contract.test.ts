import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import {
  assertOrganizationHeader,
  organizationSelection,
} from "../src/auth.js";
import type { AppConfig } from "../src/config.js";
import { signAccessToken } from "../src/security.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
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

test("organization selection follows the mobile authentication contract", () => {
  assert.deepEqual(organizationSelection({
    role: "field_agent",
    organization_id: organizationId,
    organization_name: "Active Cooperative",
  }), {
    organizations: [{ id: organizationId, name: "Active Cooperative" }],
    selectedOrganizationId: organizationId,
  });
  assert.deepEqual(organizationSelection({
    role: "system_admin",
    organization_id: null,
    organization_name: null,
  }), {
    organizations: [],
    selectedOrganizationId: null,
  });
});

test("organization header accepts only the JWT organization", () => {
  const auth = {
    userId,
    organizationId,
    role: "field_agent" as const,
    tokenVersion: 0,
  };
  assert.doesNotThrow(() => assertOrganizationHeader(undefined, auth));
  assert.doesNotThrow(() => assertOrganizationHeader(organizationId, auth));
  assert.throws(
    () => assertOrganizationHeader("db72b4e9-436e-498b-b6ef-670909e65b2f", auth),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 403,
  );
});

test("CORS preflight allows X-Organization-Id", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/geofences",
      headers: {
        origin: config.ADMIN_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "Authorization,X-Organization-Id",
      },
    });
    assert.equal(response.statusCode, 204);
    assert.match(
      String(response.headers["access-control-allow-headers"]).toLowerCase(),
      /x-organization-id/,
    );
  } finally {
    await app.close();
  }
});

function fakeTenantPool(): Pool {
  const client = {
    async query(text: string): Promise<QueryResult> {
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
      if (text.includes("FROM geofences")) {
        assert.match(text, /active = true/);
        return {
          rows: [{
            id: "37b69e74-9033-44eb-a833-cb0f8bb3fe94",
            organizationId,
            name: "Coffee region",
            polygon: {
              type: "Polygon",
              coordinates: [[[8, 50], [9, 50], [9, 51], [8, 50]]],
            },
            updatedAt: new Date("2026-09-14T20:00:00.000Z"),
          }],
          rowCount: 1,
        } as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
    release() {},
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

test("GET /api/v1/geofences returns the active mobile shape", async () => {
  const app = await buildApp(config, fakeTenantPool());
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId,
    role: "field_agent",
    tokenVersion: 0,
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/geofences",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-organization-id": organizationId,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, [{
      id: "37b69e74-9033-44eb-a833-cb0f8bb3fe94",
      organizationId,
      name: "Coffee region",
      polygon: {
        type: "Polygon",
        coordinates: [[[8, 50], [9, 50], [9, 51], [8, 50]]],
      },
      updatedAt: "2026-09-14T20:00:00.000Z",
    }]);
  } finally {
    await app.close();
  }
});

test("authenticate rejects a cross-tenant header before database access", async () => {
  const pool = {
    connect: async () => {
      throw new Error("database must not be reached for a tenant mismatch");
    },
  } as unknown as Pool;
  const app = await buildApp(config, pool);
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId,
    role: "field_agent",
    tokenVersion: 0,
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/geofences",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-organization-id": "db72b4e9-436e-498b-b6ef-670909e65b2f",
      },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "ORGANIZATION_MISMATCH");
  } finally {
    await app.close();
  }
});
