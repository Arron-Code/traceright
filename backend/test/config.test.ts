import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const requiredEnvironment = {
  DATABASE_URL: "postgres://unused",
  JWT_SECRET: "a-secret-that-is-at-least-thirty-two-bytes-long",
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

test("uses network-accessible and local storage defaults outside Vercel", () => {
  const config = loadConfig(requiredEnvironment);

  assert.equal(config.HOST, "0.0.0.0");
  assert.equal(config.STORAGE_DIR, path.resolve(process.cwd(), "storage"));
});

test("uses Vercel's writable temporary directory by default", () => {
  const config = loadConfig({ ...requiredEnvironment, VERCEL: "1" });

  assert.equal(config.STORAGE_DIR, path.resolve("/tmp/sctracker-storage"));
});
