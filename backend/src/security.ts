import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "./config.js";
import type { AuthContext } from "./types.js";

const encoder = new TextEncoder();

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createRefreshToken(): {
  id: string;
  secret: string;
  serialized: string;
  hash: string;
} {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return {
    id,
    secret,
    serialized: `${id}.${secret}`,
    hash: hashOpaqueToken(`${id}.${secret}`),
  };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function signAccessToken(
  config: AppConfig,
  auth: AuthContext,
): Promise<string> {
  return new SignJWT({
    org: auth.organizationId,
    role: auth.role,
    ver: auth.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(auth.userId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience("sctracker-api")
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(encoder.encode(config.JWT_SECRET));
}

export async function verifyAccessToken(
  config: AppConfig,
  token: string,
): Promise<AuthContext> {
  const { payload } = await jwtVerify(token, encoder.encode(config.JWT_SECRET), {
    algorithms: ["HS256"],
    issuer: config.JWT_ISSUER,
    audience: "sctracker-api",
  });
  if (
    !payload.sub ||
    typeof payload.role !== "string" ||
    typeof payload.ver !== "number" ||
    (payload.org !== null && typeof payload.org !== "string")
  ) {
    throw new Error("Invalid access token claims.");
  }
  return {
    userId: payload.sub,
    organizationId: payload.org as string | null,
    role: payload.role as AuthContext["role"],
    tokenVersion: payload.ver,
  };
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(key: Buffer, serialized: string): string {
  const [version, ivValue, tagValue, encryptedValue] = serialized.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
