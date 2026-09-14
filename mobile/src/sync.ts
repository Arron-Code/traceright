import {
  ApiError,
  pullChanges,
  pushOperations,
  type AuthRequestScope,
} from "./api";
import type {
  OutboxOperation,
  PersistedState,
  Plot,
  PushResponse,
  Supplier,
} from "./domain";

export type SyncResult = {
  state: PersistedState;
  error?: ApiError | Error;
};

const retryDelay = (attempts: number) => Math.min(60_000, 1_000 * 2 ** attempts);

function mergeRemote(
  items: Array<Supplier | Plot>,
  remote: Supplier | Plot,
): Array<Supplier | Plot> {
  const index = items.findIndex((item) => item.id === remote.id);
  if (index < 0) {
    return [...items, { ...remote, syncStatus: "synced" }];
  }
  const copy = [...items];
  copy[index] = { ...remote, syncStatus: "synced" };
  return copy;
}

type GeofenceViolation = {
  violationId: string;
  operationId: string;
  entityId: string;
};

function parseGeofenceViolations(
  details: unknown,
  ready: OutboxOperation[],
): GeofenceViolation[] | null {
  if (
    !details ||
    typeof details !== "object" ||
    !("violations" in details) ||
    !Array.isArray(details.violations) ||
    details.violations.length === 0
  ) {
    return null;
  }
  const violations: GeofenceViolation[] = [];
  for (const value of details.violations) {
    if (
      !value ||
      typeof value !== "object" ||
      !("violationId" in value) ||
      typeof value.violationId !== "string" ||
      !value.violationId ||
      !("operationId" in value) ||
      typeof value.operationId !== "string" ||
      !value.operationId ||
      !("entityId" in value) ||
      typeof value.entityId !== "string" ||
      !value.entityId
    ) {
      return null;
    }
    const operation = ready.find((item) => item.id === value.operationId);
    if (
      !operation ||
      operation.entityType !== "plot" ||
      operation.entityId !== value.entityId
    ) {
      return null;
    }
    violations.push({
      violationId: value.violationId,
      operationId: value.operationId,
      entityId: value.entityId,
    });
  }
  return violations;
}

function applyPushResult(
  state: PersistedState,
  attempted: OutboxOperation[],
  pushed: PushResponse,
): PersistedState {
  const accepted = new Set(pushed.accepted);
  const conflicts = pushed.conflicts ?? [];
  const conflictIds = new Set(conflicts.map((item) => item.operationId));
  const acceptedEntities = attempted.filter((item) => accepted.has(item.id));
  return {
    ...state,
    suppliers: state.suppliers.map((supplier) =>
      acceptedEntities.some(
        (item) => item.entityType === "supplier" && item.entityId === supplier.id,
      )
        ? { ...supplier, syncStatus: "synced" }
        : supplier,
    ),
    plots: state.plots.map((plot) =>
      acceptedEntities.some(
        (item) => item.entityType === "plot" && item.entityId === plot.id,
      )
        ? { ...plot, syncStatus: "synced" }
        : plot,
    ),
    outbox: state.outbox.filter(
      (item) => !accepted.has(item.id) && !conflictIds.has(item.id),
    ),
    conflicts: [
      ...state.conflicts,
      ...conflicts.map((conflict) => {
        const local = attempted.find((item) => item.id === conflict.operationId);
        if (!local) {
          throw new Error(`Conflict operation ${conflict.operationId} is missing.`);
        }
        return {
          id: conflict.operationId,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          local: local.payload,
          remote: conflict.remote,
          detectedAt: new Date().toISOString(),
        };
      }),
    ],
  };
}

export async function synchronize(
  input: PersistedState,
  force = false,
  expectedScope?: AuthRequestScope,
): Promise<SyncResult> {
  let state: PersistedState = {
    ...input,
    outbox: input.outbox.map((item) => ({ ...item })),
    conflicts: [...input.conflicts],
  };
  const now = Date.now();
  const ready = state.outbox.filter(
    (item) => force || !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now,
  );
  let reviewError: ApiError | undefined;
  let failureCandidates = ready;
  try {
    if (ready.length > 0) {
      try {
        const pushed = await pushOperations(state.deviceId, ready, expectedScope);
        state = applyPushResult(state, ready, pushed);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "GEOFENCE_REVIEW_REQUIRED") {
          throw error;
        }
        reviewError = error;
        const violations = parseGeofenceViolations(error.details, ready);
        if (violations) {
          const violationByOperation = new Map(
            violations.map((violation) => [violation.operationId, violation]),
          );
          const reviewPlotIds = new Set(violations.map(({ entityId }) => entityId));
          state = {
            ...state,
            plots: state.plots.map((plot) =>
              reviewPlotIds.has(plot.id)
                ? { ...plot, geofenceStatus: "review_required" }
                : plot
            ),
            outbox: state.outbox.map((item) => {
              const violation = violationByOperation.get(item.id);
              return violation
                ? {
                    ...item,
                    nextAttemptAt: "9999-12-31T23:59:59.999Z",
                    lastError: error.message,
                    geofenceViolationId: violation.violationId,
                  }
                : item;
            }),
          };
          const remaining = ready.filter((item) => !violationByOperation.has(item.id));
          failureCandidates = remaining;
          if (remaining.length > 0) {
            const secondPush = await pushOperations(state.deviceId, remaining, expectedScope);
            state = applyPushResult(state, remaining, secondPush);
          }
        } else {
          failureCandidates = [];
        }
      }
    }
    const pulled = await pullChanges(state.cursor, expectedScope);
    for (const change of pulled.changes) {
      const hasLocalChange = state.outbox.some(
        (item) =>
          item.entityType === change.entityType && item.entityId === change.entity.id,
      );
      if (hasLocalChange) {
        const local = change.entityType === "supplier"
          ? state.suppliers.find((item) => item.id === change.entity.id)
          : state.plots.find((item) => item.id === change.entity.id);
        if (
          local &&
          !state.conflicts.some(
            (item) =>
              item.entityType === change.entityType && item.entityId === change.entity.id,
          )
        ) {
          state.conflicts.push({
            id: `pull:${change.entityType}:${change.entity.id}:${pulled.cursor}`,
            entityType: change.entityType,
            entityId: change.entity.id,
            local,
            remote: change.entity,
            detectedAt: new Date().toISOString(),
          });
        }
        continue;
      }
      if (change.entityType === "supplier") {
        state.suppliers = mergeRemote(state.suppliers, change.entity) as Supplier[];
      } else {
        state.plots = mergeRemote(state.plots, change.entity) as Plot[];
      }
    }
    state.cursor = pulled.cursor;
    state.lastSyncAt = new Date().toISOString();
    return { state, error: reviewError };
  } catch (error) {
    const readyIds = new Set(failureCandidates.map((item) => item.id));
    state.outbox = state.outbox.map((item): OutboxOperation => {
      if (!readyIds.has(item.id)) {
        return item;
      }
      const attempts = item.attempts + 1;
      return {
        ...item,
        attempts,
        nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    });
    return { state, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
