import { createHash } from "node:crypto";
import { z } from "zod";
import { badRequest } from "./errors.js";
import type { GeoJsonPolygon } from "./types.js";

const position = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(position).min(4)).min(1),
});

function equalPosition(left: number[], right: number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function parsePolygon(value: unknown): GeoJsonPolygon {
  const parsed = polygonSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("INVALID_GEOMETRY", "A valid GeoJSON Polygon is required.", parsed.error.flatten());
  }
  for (const ring of parsed.data.coordinates) {
    if (!equalPosition(ring[0]!, ring[ring.length - 1]!)) {
      throw badRequest("INVALID_GEOMETRY", "Every polygon ring must be closed.");
    }
    const unique = new Set(ring.slice(0, -1).map(([x, y]) => `${x}:${y}`));
    if (unique.size < 3) {
      throw badRequest("INVALID_GEOMETRY", "A polygon needs at least three distinct positions.");
    }
  }
  return parsed.data;
}

export function geometryHash(polygon: GeoJsonPolygon): string {
  return createHash("sha256").update(JSON.stringify(polygon)).digest("hex");
}
