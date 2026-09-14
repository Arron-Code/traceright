import type { PoolClient } from "pg";

export const roles = [
  "system_admin",
  "org_admin",
  "reviewer",
  "field_agent",
  "auditor",
] as const;
export type Role = (typeof roles)[number];

export type AuthContext = {
  userId: string;
  organizationId: string | null;
  role: Role;
  tokenVersion: number;
};

export type TenantClient = PoolClient;

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
