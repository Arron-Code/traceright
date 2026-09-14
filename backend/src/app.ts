import "dotenv/config";
// Vercel's Fastify detector requires a direct framework import in this entrypoint.
import "fastify";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./application.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

let application: Promise<FastifyInstance> | undefined;

async function getApplication(): Promise<FastifyInstance> {
  application ??= (async () => {
    const config = loadConfig();
    const pool = createPool(config);
    await mkdir(config.STORAGE_DIR, { recursive: true });
    const app = await buildApp(config, pool);
    await app.ready();
    return app;
  })();
  return application;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await getApplication();
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app.server.emit("request", request, response);
  });
}
