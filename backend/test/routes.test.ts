import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

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

test("mobile and admin routes reject unauthenticated access with the standard envelope", async () => {
  const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    for (const request of [
      { method: "POST", url: "/api/v1/sync/push", payload: { deviceId: "d", operations: [] } },
      { method: "GET", url: "/api/v1/sync/pull" },
      { method: "POST", url: "/api/v1/documents/uploads", payload: {} },
      { method: "POST", url: "/api/v1/satellite/analyses", payload: {} },
      { method: "POST", url: "/api/v1/evidence-packs", payload: {} },
      { method: "POST", url: "/api/v1/dds/drafts", payload: {} },
      { method: "GET", url: "/api/v1/geofences" },
      { method: "GET", url: "/api/v1/admin/organizations" },
    ] as const) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401, `${request.method} ${request.url}`);
      assert.equal(response.json().error.code, "UNAUTHORIZED");
    }
  } finally {
    await app.close();
  }
});

test("unknown routes use the documented error envelope", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  } finally {
    await app.close();
  }
});

test("admin SPA is served with restrictive browser headers", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    const response = await app.inject({ method: "GET", url: "/admin/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /SCTracker Administration/);
    assert.match(response.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.equal(response.headers["x-frame-options"], "DENY");
    const roles = await app.inject({ method: "GET", url: "/admin/roles.js" });
    assert.equal(roles.statusCode, 200);
    assert.match(roles.body, /allowedTabsForRole/);
  } finally {
    await app.close();
  }
});
