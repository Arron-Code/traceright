import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import {
  createRefreshToken,
  decryptSecret,
  encryptSecret,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../src/security.js";

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

test("passwords use Argon2id and verify safely", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
});

test("access tokens preserve tenant and role claims", async () => {
  const input = {
    userId: "c2314a55-b213-4dce-8754-f144cd93848a",
    organizationId: "b23815e3-8701-41bc-b0a4-168f07521dd5",
    role: "reviewer" as const,
    tokenVersion: 4,
  };
  const token = await signAccessToken(config, input);
  assert.deepEqual(await verifyAccessToken(config, token), input);
  await assert.rejects(() => verifyAccessToken(config, `${token}x`));
});

test("refresh tokens are high entropy and do not expose their hash", () => {
  const token = createRefreshToken();
  assert.equal(token.serialized.startsWith(`${token.id}.`), true);
  assert.notEqual(token.hash, token.serialized);
  assert.equal(token.hash.length, 64);
});

test("configuration secrets round-trip through authenticated encryption", () => {
  const encrypted = encryptSecret(config.CONFIG_ENCRYPTION_KEY, "top-secret");
  assert.equal(encrypted.includes("top-secret"), false);
  assert.equal(decryptSecret(config.CONFIG_ENCRYPTION_KEY, encrypted), "top-secret");
  assert.throws(() => decryptSecret(randomBytes(32), encrypted));
});
