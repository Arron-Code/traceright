export type Position = [number, number];

export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: Position[][];
};

export type Organization = {
  id: string;
  name: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

export type AuthSession = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  user: AuthUser;
  organizations: Organization[];
  selectedOrganizationId: string | null;
};

export type GeofenceStatus =
  | "pending"
  | "inside"
  | "outside"
  | "review_required"
  | "approved";

export type OrganizationGeofence = {
  id: string;
  organizationId: string;
  name?: string;
  polygon: GeoJsonPolygon;
  updatedAt?: string;
};

export type SyncStatus = "pending" | "syncing" | "synced" | "conflict" | "failed";

export type Plot = {
  id: string;
  supplierId?: string;
  producer: string;
  farmName: string;
  areaHa: string;
  polygon: GeoJsonPolygon;
  geofenceStatus: GeofenceStatus;
  localGeofenceResult: "pending" | "inside" | "outside";
  capturedAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
};

export type Supplier = {
  id: string;
  name: string;
  region: string;
  producerCount: number;
  plotCount: number;
  updatedAt: string;
  syncStatus: SyncStatus;
};

export type DocumentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: "uploading" | "uploaded" | "failed";
  createdAt: string;
};

export type OperationStatus = "queued" | "processing" | "completed" | "failed" | "not_configured";

export type OperationalRequest = {
  id: string;
  kind: "satellite" | "evidence_pack" | "dds";
  subjectId: string;
  status: OperationStatus;
  downloadUrl?: string;
  message?: string;
  updatedAt: string;
};

export type OutboxOperation = {
  id: string;
  idempotencyKey: string;
  entityType: "supplier" | "plot";
  entityId: string;
  action: "upsert";
  payload: Supplier | Plot;
  createdAt: string;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  geofenceViolationId?: string;
};

export type SyncConflict = {
  id: string;
  entityType: OutboxOperation["entityType"];
  entityId: string;
  local: Supplier | Plot;
  remote: Supplier | Plot;
  detectedAt: string;
};

export type PersistedState = {
  version: 3;
  deviceId: string;
  cursor: string | null;
  suppliers: Supplier[];
  plots: Plot[];
  documents: DocumentRecord[];
  operations: OperationalRequest[];
  outbox: OutboxOperation[];
  conflicts: SyncConflict[];
  geofences: OrganizationGeofence[];
  lastSyncAt: string | null;
};

export type LegacyPlotDraft = {
  id?: string;
  producer?: string;
  farmName?: string;
  areaHa?: string;
  latitude?: number;
  longitude?: number;
  capturedAt?: string;
};

export type PushResponse = {
  accepted: string[];
  conflicts?: Array<{
    operationId: string;
    entityType: OutboxOperation["entityType"];
    entityId: string;
    remote: Supplier | Plot;
  }>;
};

export type PullResponse = {
  cursor: string;
  changes: Array<
    | { entityType: "supplier"; entity: Supplier }
    | { entityType: "plot"; entity: Plot }
  >;
};

export function createUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function closePolygon(points: Position[]): GeoJsonPolygon {
  if (points.length < 3) {
    throw new Error("A polygon requires at least three positions.");
  }
  const first = points[0];
  const last = points[points.length - 1];
  const closed =
    first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
  const polygon: GeoJsonPolygon = { type: "Polygon", coordinates: [closed] };
  validatePolygon(polygon);
  return polygon;
}

const positionsEqual = (left: Position, right: Position) =>
  left[0] === right[0] && left[1] === right[1];

function orientation(a: Position, b: Position, c: Position): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) -
    (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(value) < 1e-12 ? 0 : value > 0 ? 1 : -1;
}

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  return orientation(start, point, end) === 0 &&
    point[0] >= Math.min(start[0], end[0]) - 1e-12 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-12 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-12 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-12;
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC !== abD && cdA !== cdB) ||
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d));
}

function validateRing(ring: Position[]): void {
  if (ring.length < 4) throw new Error("A polygon ring needs at least four positions.");
  if (!positionsEqual(ring[0], ring[ring.length - 1])) {
    throw new Error("A polygon ring must be closed.");
  }
  for (const position of ring) {
    if (
      !Array.isArray(position) ||
      position.length !== 2 ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      position[0] < -180 ||
      position[0] > 180 ||
      position[1] < -90 ||
      position[1] > 90
    ) {
      throw new Error("Polygon coordinates are outside valid longitude/latitude ranges.");
    }
  }
  const distinct = new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`));
  if (distinct.size < 3) throw new Error("A polygon requires three distinct positions.");
  for (let index = 0; index < ring.length - 1; index += 1) {
    if (positionsEqual(ring[index], ring[index + 1])) {
      throw new Error("Adjacent polygon positions must be distinct.");
    }
  }

  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    twiceArea += ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  if (Math.abs(twiceArea) < 1e-12) throw new Error("A polygon must have a non-zero area.");

  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === segmentCount - 1);
      if (
        !adjacent &&
        segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])
      ) {
        throw new Error("A polygon ring must not self-intersect.");
      }
    }
  }
}

export function validatePolygon(value: unknown): asserts value is GeoJsonPolygon {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== "Polygon" ||
    !("coordinates" in value) ||
    !Array.isArray(value.coordinates) ||
    value.coordinates.length === 0
  ) {
    throw new Error("GeoJSON must be a Polygon.");
  }
  for (const unknownRing of value.coordinates) {
    if (
      !Array.isArray(unknownRing) ||
      unknownRing.some(
      (position: unknown) =>
        !Array.isArray(position) ||
        position.length !== 2 ||
        !Number.isFinite(position[0]) ||
        !Number.isFinite(position[1]),
      )
    ) {
      throw new Error("Polygon coordinates are invalid.");
    }
    validateRing(unknownRing as Position[]);
  }
}

export function parsePolygon(value: string): GeoJsonPolygon {
  const parsed: unknown = JSON.parse(value);
  validatePolygon(parsed);
  return parsed;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 2; current < ring.length - 1; previous = current++) {
    const start = ring[previous];
    const end = ring[current];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]) &&
      point[0] < ((end[0] - start[0]) * (point[1] - start[1])) /
        (end[1] - start[1]) + start[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Position, polygon: GeoJsonPolygon): boolean {
  validatePolygon(polygon);
  if (!pointInRing(point, polygon.coordinates[0])) return false;
  return !polygon.coordinates.slice(1).some((hole) => pointInRing(point, hole));
}

export function evaluatePlotGeofence(
  plot: GeoJsonPolygon,
  geofences: OrganizationGeofence[],
): "pending" | "inside" | "outside" {
  validatePolygon(plot);
  if (geofences.length === 0) return "pending";
  const vertices = plot.coordinates[0].slice(0, -1);
  return geofences.some((geofence) => {
    validatePolygon(geofence.polygon);
    return vertices.every((position) => pointInPolygon(position, geofence.polygon));
  }) ? "inside" : "outside";
}
