import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { createAuthenticator, registerAuthRoutes } from "./auth.js";
import { AppError } from "./errors.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerSyncRoutes } from "./routes/sync.js";

export async function buildApp(config: AppConfig, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 52_428_800,
    trustProxy: true,
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "body.password",
          "body.refreshToken",
          "body.eu.password",
          "body.eu.username",
          "body.eu.clientId",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.decorateRequest("auth", null);
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === config.ADMIN_ORIGIN) callback(null, true);
      else callback(new Error("Origin is not allowed."), false);
    },
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Organization-Id",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceAdminRoot = path.resolve(moduleDirectory, "..", "..", "admin");
  const adminRoot = existsSync(sourceAdminRoot)
    ? sourceAdminRoot
    : path.resolve(moduleDirectory, "..", "..", "..", "admin");
  const adminAssets = new Map([
    ["/admin/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
    ["/admin/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
    ["/admin/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
    ["/admin/roles.js", { file: "roles.js", contentType: "text/javascript; charset=utf-8" }],
    ["/admin/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ]);
  for (const [route, asset] of adminAssets) {
    app.get(route, async (_request, reply) =>
      reply.type(asset.contentType).send(await readFile(path.join(adminRoot, asset.file))));
  }

  app.addHook("onSend", async (_request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
      );
  });

  app.get("/", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/health", async (_request, reply) => {
    await pool.query("SELECT 1");
    return reply.send({ data: { status: "ok" } });
  });

  const authenticate = createAuthenticator(pool, config);
  await registerAuthRoutes(app, pool, config, authenticate);
  await registerAdminRoutes(app, pool, config, authenticate);
  await registerSyncRoutes(app, pool, authenticate);
  await registerDocumentRoutes(app, pool, config, authenticate);
  await registerOperationRoutes(app, pool, config, authenticate);

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505") {
      return reply.code(409).send({
        error: { code: "DUPLICATE", message: "A resource with these unique fields already exists." },
      });
    }
    if (pgCode === "23503") {
      return reply.code(409).send({
        error: { code: "REFERENCE_CONFLICT", message: "A referenced resource does not exist or is still in use." },
      });
    }
    if (pgCode === "23502" || pgCode === "23514" || pgCode === "22P02") {
      return reply.code(400).send({
        error: { code: "INVALID_DATA", message: "The supplied data violates a database constraint." },
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
    });
  });
  return app;
}
