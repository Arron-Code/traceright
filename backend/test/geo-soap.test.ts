import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { geometryHash, parsePolygon } from "../src/geo.js";
import { buildDdsEnvelope, EuSubmissionError, submitDds } from "../src/soap.js";

const appConfig: AppConfig = {
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
const payload = {
  id: "1db48d88-b22f-42db-8d9d-20bcb14c0f27",
  subjectId: "shipment<&>",
  organizationId: "b23815e3-8701-41bc-b0a4-168f07521dd5",
};

test("GeoJSON polygons are range checked, closed, and deterministically hashed", () => {
  const polygon = parsePolygon({
    type: "Polygon",
    coordinates: [[[8, 50], [9, 50], [9, 51], [8, 50]]],
  });
  assert.equal(geometryHash(polygon), geometryHash(polygon));
  assert.throws(() => parsePolygon({
    type: "Polygon",
    coordinates: [[[181, 50], [9, 50], [9, 51], [181, 50]]],
  }));
  assert.throws(() => parsePolygon({
    type: "Polygon",
    coordinates: [[[8, 50], [9, 50], [9, 51], [8, 51]]],
  }));
});

test("SOAP envelope XML-escapes data", () => {
  const envelope = buildDdsEnvelope(payload);
  assert.match(envelope, /shipment&lt;&amp;&gt;/);
  assert.doesNotMatch(envelope, /shipment<&>/);
});

test("safe mock mode performs no network request", async () => {
  let requested = false;
  const result = await submitDds(appConfig, {
    mode: "mock",
    endpoint: null,
    timeoutMs: 1000,
    usernameCiphertext: null,
    passwordCiphertext: null,
    clientIdCiphertext: null,
  }, payload, async () => {
    requested = true;
    throw new Error("must not be called");
  });
  assert.equal(requested, false);
  assert.equal(result.mock, true);
  assert.match(result.reference, /^MOCK-/);
});

test("live SOAP mode rejects SSRF targets and accepts a valid response", async () => {
  await assert.rejects(() => submitDds(appConfig, {
    mode: "live",
    endpoint: "https://127.0.0.1/eudr",
    timeoutMs: 1000,
    usernameCiphertext: null,
    passwordCiphertext: null,
    clientIdCiphertext: null,
  }, payload));

  const result = await submitDds(appConfig, {
    mode: "live",
    endpoint: "https://8.8.8.8/eudr",
    timeoutMs: 1000,
    usernameCiphertext: null,
    passwordCiphertext: null,
    clientIdCiphertext: null,
  }, payload, async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return new Response("<Reference>EU-REF-42</Reference>", { status: 200 });
  });
  assert.deepEqual(result, { reference: "EU-REF-42", mock: false });
});

test("live SOAP mode classifies ambiguous results for reconciliation", async () => {
  const adapter = {
    mode: "live" as const,
    endpoint: "https://8.8.8.8/eudr",
    timeoutMs: 5,
    usernameCiphertext: null,
    passwordCiphertext: null,
    clientIdCiphertext: null,
  };
  for (const fetchImplementation of [
    async () => { throw new Error("socket closed"); },
    async () => new Response("upstream unavailable", { status: 503 }),
    async () => new Response("<Success/>", { status: 200 }),
  ] as Array<typeof fetch>) {
    await assert.rejects(
      () => submitDds(appConfig, adapter, payload, fetchImplementation),
      (error) => error instanceof EuSubmissionError && error.outcome === "uncertain",
    );
  }
});

test("live SOAP mode distinguishes definitive service rejection from timeout", async () => {
  const adapter = {
    mode: "live" as const,
    endpoint: "https://8.8.8.8/eudr",
    timeoutMs: 5,
    usernameCiphertext: null,
    passwordCiphertext: null,
    clientIdCiphertext: null,
  };
  await assert.rejects(
    () => submitDds(appConfig, adapter, payload, async () =>
      new Response("invalid request", { status: 400 })),
    (error) => error instanceof EuSubmissionError && error.outcome === "failed",
  );
  await assert.rejects(
    () => submitDds(appConfig, adapter, payload, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
    (error) => error instanceof EuSubmissionError && error.outcome === "uncertain",
  );
});
