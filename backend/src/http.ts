import type { FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodType } from "zod";
import { AppError, badRequest, forbidden } from "./errors.js";
import type { AuthContext, Role } from "./types.js";

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest("VALIDATION_ERROR", "Request validation failed.", result.error.flatten());
  }
  return result.data;
}

export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
  return request.auth;
}

export function requireRoles(request: FastifyRequest, allowed: readonly Role[]): AuthContext {
  const auth = authOf(request);
  if (!allowed.includes(auth.role)) throw forbidden();
  return auth;
}

export function organizationFor(
  request: FastifyRequest,
  requestedOrganizationId?: string,
): string {
  const auth = authOf(request);
  if (auth.role === "system_admin") {
    if (!requestedOrganizationId) {
      throw badRequest("ORGANIZATION_REQUIRED", "An organization id is required.");
    }
    return requestedOrganizationId;
  }
  if (!auth.organizationId) throw forbidden();
  if (requestedOrganizationId && requestedOrganizationId !== auth.organizationId) {
    throw forbidden("Cross-organization access is not allowed.");
  }
  return auth.organizationId;
}

export function sendData<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.code(statusCode).send({ data });
}

export const uuidSchema = z.string().uuid();
