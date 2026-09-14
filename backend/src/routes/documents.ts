import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryOne, withContext } from "../db.js";
import { AppError, conflict, notFound } from "../errors.js";
import { authOf, parse, sendData, uuidSchema } from "../http.js";
import { constantTimeEqual, hashOpaqueToken } from "../security.js";

const initiateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  size: z.number().int().min(1).max(52_428_800),
});

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  }
  return value;
}

export async function registerDocumentRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  app.post("/api/v1/documents/uploads", { preHandler: authenticate }, async (request, reply) => {
    const auth = authOf(request);
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (!["org_admin", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot upload documents.");
    }
    const body = parse(initiateSchema, request.body);
    const idempotencyKey = requireIdempotencyKey(request);
    const token = randomBytes(32).toString("base64url");
    const documentId = randomUUID();
    const storageKey = `${auth.organizationId}/${documentId}`;
    const document = await withContext(pool, auth, async (client) => {
      const existing = await queryOne<{
        id: string;
        storage_key: string;
        file_name: string;
        mime_type: string;
        byte_size: number;
      }>(client,
        `SELECT id, storage_key, file_name, mime_type, byte_size
           FROM documents WHERE organization_id = $1 AND idempotency_key = $2`,
        [auth.organizationId, idempotencyKey]);
      if (existing) {
        if (
          existing.file_name !== body.fileName ||
          existing.mime_type !== body.mimeType ||
          Number(existing.byte_size) !== body.size
        ) {
          throw conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used with different upload metadata.",
          );
        }
        await client.query(
          "UPDATE documents SET upload_token_hash = $2 WHERE id = $1",
          [existing.id, hashOpaqueToken(token)],
        );
        return { id: existing.id };
      }
      const row = await queryOne<{ id: string }>(client,
        `INSERT INTO documents(
           id, organization_id, file_name, mime_type, byte_size, storage_key,
           upload_token_hash, idempotency_key, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          documentId,
          auth.organizationId,
          body.fileName,
          body.mimeType,
          body.size,
          storageKey,
          hashOpaqueToken(token),
          idempotencyKey,
          auth.userId,
        ]);
      await writeAudit(client, request, auth, "document.upload.initiate", "document", row!.id, {
        fileName: body.fileName,
        mimeType: body.mimeType,
        size: body.size,
      });
      return row!;
    });
    return sendData(reply, {
      documentId: document.id,
      uploadUrl: `${config.PUBLIC_BASE_URL}/api/v1/documents/uploads/${document.id}/content?token=${encodeURIComponent(token)}`,
      headers: { "Content-Type": body.mimeType },
    }, 201);
  });

  app.put("/api/v1/documents/uploads/:documentId/content", async (request, reply) => {
    const { documentId } = parse(z.object({ documentId: uuidSchema }), request.params);
    const { token } = parse(z.object({ token: z.string().min(20).max(512) }), request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw new AppError(415, "INVALID_UPLOAD", "The upload body must contain raw file bytes.");
    }
    const document = await withContext(pool, "system", (client) =>
      queryOne<{
        id: string;
        organization_id: string;
        storage_key: string;
        byte_size: number;
        status: string;
        upload_token_hash: string;
      }>(client, "SELECT * FROM documents WHERE id = $1", [documentId]));
    if (!document || !constantTimeEqual(document.upload_token_hash, hashOpaqueToken(token))) {
      throw new AppError(401, "INVALID_UPLOAD_TOKEN", "The upload token is invalid.");
    }
    if (request.body.length !== Number(document.byte_size)) {
      throw new AppError(400, "SIZE_MISMATCH", "Uploaded bytes do not match the declared size.");
    }
    const filePath = path.resolve(config.STORAGE_DIR, document.storage_key);
    const expectedRoot = `${path.resolve(config.STORAGE_DIR)}${path.sep}`;
    if (!filePath.startsWith(expectedRoot)) throw new AppError(500, "INVALID_STORAGE_KEY", "Invalid storage key.");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, request.body, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(filePath);
      if (!existing.equals(request.body as Buffer)) throw conflict("UPLOAD_ALREADY_USED", "Different bytes were already uploaded.");
    });
    const digest = createHash("sha256").update(request.body).digest("hex");
    await withContext(pool, "system", async (client) => {
      await client.query(
        `UPDATE documents
            SET status = CASE WHEN status = 'completed' THEN status ELSE 'uploaded' END,
                sha256 = $2
          WHERE id = $1`,
        [documentId, digest],
      );
    });
    return reply.code(204).send();
  });

  app.post("/api/v1/documents/uploads/:documentId/complete", { preHandler: authenticate }, async (request, reply) => {
    const auth = authOf(request);
    const { documentId } = parse(z.object({ documentId: uuidSchema }), request.params);
    const result = await withContext(pool, auth, async (client) => {
      const document = await queryOne<{
        id: string;
        status: string;
        storage_key: string;
        byte_size: number;
      }>(client,
        "SELECT id, status, storage_key, byte_size FROM documents WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        [documentId, auth.organizationId]);
      if (!document) throw notFound("Document");
      if (document.status === "completed") return { id: document.id, status: document.status };
      if (document.status !== "uploaded") {
        throw conflict("UPLOAD_INCOMPLETE", "Upload bytes have not been received.");
      }
      const information = await stat(path.resolve(config.STORAGE_DIR, document.storage_key));
      if (information.size !== Number(document.byte_size)) {
        throw conflict("SIZE_MISMATCH", "Stored bytes do not match the declared size.");
      }
      await client.query("UPDATE documents SET status = 'completed' WHERE id = $1", [document.id]);
      await writeAudit(client, request, auth, "document.upload.complete", "document", document.id);
      return { id: document.id, status: "completed" };
    });
    return sendData(reply, result);
  });

  app.get("/api/v1/documents/:documentId", { preHandler: authenticate }, async (request, reply) => {
    const auth = authOf(request);
    const { documentId } = parse(z.object({ documentId: uuidSchema }), request.params);
    const document = await withContext(pool, auth, (client) =>
      queryOne<{ storage_key: string; mime_type: string; file_name: string; status: string }>(client,
        `SELECT storage_key, mime_type, file_name, status FROM documents
          WHERE id = $1 AND organization_id = $2`,
        [documentId, auth.organizationId]));
    if (!document || document.status !== "completed") throw notFound("Document");
    const bytes = await readFile(path.resolve(config.STORAGE_DIR, document.storage_key));
    return reply
      .header("Content-Type", document.mime_type)
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.file_name)}`)
      .send(bytes);
  });
}
