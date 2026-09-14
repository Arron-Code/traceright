import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { writeAudit } from "./audit.js";
import { queryMany, queryOne, withContext } from "./db.js";
import { AppError, badRequest } from "./errors.js";
import { parse, sendData } from "./http.js";
import {
  constantTimeEqual,
  createRefreshToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "./security.js";
import type { AuthContext, Role } from "./types.js";

type UserRow = {
  id: string;
  organization_id: string | null;
  organization_name?: string | null;
  email: string;
  display_name: string;
  password_hash: string;
  role: Role;
  active: boolean;
  token_version: number;
};

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
  organizationSlug: z.string().min(2).max(63).optional(),
});
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512) });

function publicUser(user: UserRow) {
  return {
    id: user.id,
    organizationId: user.organization_id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
  };
}

export function organizationSelection(
  user: Pick<UserRow, "role" | "organization_id" | "organization_name">,
) {
  if (
    user.role === "system_admin" ||
    !user.organization_id ||
    !user.organization_name
  ) {
    return { organizations: [], selectedOrganizationId: null };
  }
  return {
    organizations: [{ id: user.organization_id, name: user.organization_name }],
    selectedOrganizationId: user.organization_id,
  };
}

export function assertOrganizationHeader(
  header: string | string[] | undefined,
  claims: AuthContext,
): void {
  if (header === undefined) return;
  if (
    typeof header !== "string" ||
    !claims.organizationId ||
    header !== claims.organizationId
  ) {
    throw new AppError(
      403,
      "ORGANIZATION_MISMATCH",
      "X-Organization-Id does not match the authenticated organization.",
    );
  }
}

async function issueTokens(
  pool: Pool,
  config: AppConfig,
  user: UserRow,
  familyId?: string,
  rotatedFromId?: string,
) {
  const auth: AuthContext = {
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    tokenVersion: user.token_version,
  };
  const refresh = createRefreshToken();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await withContext(pool, "system", async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens
        (id, family_id, user_id, organization_id, token_hash, rotated_from_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        refresh.id,
        familyId ?? refresh.id,
        user.id,
        user.organization_id,
        refresh.hash,
        rotatedFromId ?? null,
        expiresAt,
      ],
    );
  });
  return {
    accessToken: await signAccessToken(config, auth),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.serialized,
    refreshExpiresAt: expiresAt.toISOString(),
    user: publicUser(user),
    ...organizationSelection(user),
  };
}

export function createAuthenticator(pool: Pool, config: AppConfig) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHORIZED", "A Bearer access token is required.");
    }
    let claims: AuthContext;
    try {
      claims = await verifyAccessToken(config, authorization.slice(7));
    } catch {
      throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
    }
    assertOrganizationHeader(request.headers["x-organization-id"], claims);
    const current = await withContext(pool, "system", (client) =>
      queryOne<{ active: boolean; token_version: number; organization_id: string | null; role: Role }>(
        client,
        "SELECT active, token_version, organization_id, role FROM users WHERE id = $1",
        [claims.userId],
      ));
    if (
      !current?.active ||
      current.token_version !== claims.tokenVersion ||
      current.organization_id !== claims.organizationId ||
      current.role !== claims.role
    ) {
      throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is no longer valid.");
    }
    request.auth = claims;
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const users = await withContext(pool, "system", (client) =>
      queryMany<UserRow>(
        client,
        `SELECT u.*, o.name AS organization_name
           FROM users u
           LEFT JOIN organizations o ON o.id = u.organization_id
          WHERE lower(u.email) = $1
            AND ($2::text IS NULL OR o.slug = $2)
            AND u.active = true
            AND (o.active = true OR u.role = 'system_admin')
          LIMIT 2`,
        [body.email, body.organizationSlug ?? null],
      ));
    if (users.length !== 1 || !(await verifyPassword(users[0]!.password_hash, body.password))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email, password, or organization.");
    }
    const user = users[0]!;
    const tokens = await issueTokens(pool, config, user);
    const auth: AuthContext = {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
      tokenVersion: user.token_version,
    };
    await withContext(pool, "system", (client) =>
      writeAudit(client, request, auth, "auth.login", "user", user.id));
    return sendData(reply, tokens);
  });

  app.post("/api/v1/auth/refresh", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { refreshToken } = parse(refreshSchema, request.body);
    const [id] = refreshToken.split(".");
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid.");
    }
    const nextRefresh = createRefreshToken();
    const nextExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const result = await withContext(pool, "system", async (client) => {
      const token = await queryOne<{
        id: string;
        family_id: string;
        token_hash: string;
        used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        user_id: string;
      }>(client, "SELECT * FROM refresh_tokens WHERE id = $1 FOR UPDATE", [id]);
      if (!token || !constantTimeEqual(token.token_hash, hashOpaqueToken(refreshToken))) {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid.");
      }
      if (token.used_at || token.revoked_at) {
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1",
          [token.family_id],
        );
        return { error: "reuse" as const };
      }
      if (token.expires_at.getTime() <= Date.now()) {
        await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [token.id]);
        return { error: "expired" as const };
      }
      const user = await queryOne<UserRow>(
        client,
        `SELECT u.*, o.name AS organization_name
           FROM users u
           LEFT JOIN organizations o ON o.id = u.organization_id
          WHERE u.id = $1
            AND u.active = true
            AND (u.role = 'system_admin' OR o.active = true)`,
        [token.user_id],
      );
      if (!user) {
        throw new AppError(
          401,
          "INVALID_REFRESH_TOKEN",
          "The user or organization is inactive.",
        );
      }
      await client.query("UPDATE refresh_tokens SET used_at = now() WHERE id = $1", [token.id]);
      await client.query(
        `INSERT INTO refresh_tokens
          (id, family_id, user_id, organization_id, token_hash, rotated_from_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          nextRefresh.id,
          token.family_id,
          user.id,
          user.organization_id,
          nextRefresh.hash,
          token.id,
          nextExpiresAt,
        ],
      );
      return { token, user, error: null };
    });
    if (result.error === "reuse") {
      throw new AppError(401, "REFRESH_TOKEN_REUSE", "Refresh token reuse was detected; the session was revoked.");
    }
    if (result.error === "expired") {
      throw new AppError(401, "REFRESH_TOKEN_EXPIRED", "The refresh token has expired.");
    }
    const auth: AuthContext = {
      userId: result.user.id,
      organizationId: result.user.organization_id,
      role: result.user.role,
      tokenVersion: result.user.token_version,
    };
    return sendData(reply, {
      accessToken: await signAccessToken(config, auth),
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: nextRefresh.serialized,
      refreshExpiresAt: nextExpiresAt.toISOString(),
      user: publicUser(result.user),
      ...organizationSelection(result.user),
    });
  });

  app.post("/api/v1/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    const { refreshToken } = parse(refreshSchema, request.body);
    const tokenHash = hashOpaqueToken(refreshToken);
    await withContext(pool, "system", async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
          WHERE family_id = (
            SELECT family_id FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2
          )`,
        [tokenHash, request.auth!.userId],
      );
      await writeAudit(client, request, request.auth!, "auth.logout", "user", request.auth!.userId);
    });
    return sendData(reply, { loggedOut: true });
  });

  app.get("/api/v1/auth/me", { preHandler: authenticate }, async (request, reply) => {
    const user = await withContext(pool, request.auth!, (client) =>
      queryOne<UserRow>(client, "SELECT * FROM users WHERE id = $1", [request.auth!.userId]));
    if (!user) throw badRequest("USER_NOT_FOUND", "The authenticated user no longer exists.");
    return sendData(reply, publicUser(user));
  });
}
