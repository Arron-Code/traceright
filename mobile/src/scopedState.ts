import {
  createUuid,
  type PersistedState,
} from "./domain";

const GLOBAL_STATE_KEY = "sctracker.mobileState.v3";
const PREVIOUS_STATE_KEY = "sctracker.mobileState.v2";
const LEGACY_PLOTS_KEY = "sctracker.plotDrafts.v1";
const SCOPED_STATE_PREFIX = "sctracker.mobileState.v3.scope";
const LEGACY_KEYS = [GLOBAL_STATE_KEY, PREVIOUS_STATE_KEY, LEGACY_PLOTS_KEY];
export const LEGACY_QUARANTINE_KEY = "sctracker.mobileState.legacyQuarantine.v1";

export type StateScope = {
  userId: string;
  organizationId: string;
};

export type StateStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function getStateStorageKey(scope: StateScope): string {
  return `${SCOPED_STATE_PREFIX}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.organizationId)}`;
}

export function emptyState(): PersistedState {
  return {
    version: 3,
    deviceId: createUuid(),
    cursor: null,
    suppliers: [],
    plots: [],
    documents: [],
    operations: [],
    outbox: [],
    conflicts: [],
    geofences: [],
    lastSyncAt: null,
  };
}

export function createScopedStateRepository(storage: StateStorage) {
  let quarantineRun: Promise<void> | null = null;

  function quarantineLegacyState(): Promise<void> {
    if (!quarantineRun) {
      quarantineRun = (async () => {
        const legacyValues = await Promise.all(
          LEGACY_KEYS.map(async (sourceKey) => ({
            sourceKey,
            rawValue: await storage.getItem(sourceKey),
          })),
        );
        const found = legacyValues.filter(
          (entry): entry is { sourceKey: string; rawValue: string } =>
            entry.rawValue !== null,
        );
        if (found.length === 0) return;

        const existingValue = await storage.getItem(LEGACY_QUARANTINE_KEY);
        const existing = existingValue
          ? JSON.parse(existingValue) as {
              version: 1;
              entries: Array<{
                sourceKey: string;
                format: string;
                rawValue: string;
                quarantinedAt: string;
              }>;
            }
          : { version: 1 as const, entries: [] };
        if (existing.version !== 1 || !Array.isArray(existing.entries)) {
          throw new Error("Legacy quarantine data is invalid.");
        }
        const formats: Record<string, string> = {
          [GLOBAL_STATE_KEY]: "persisted-state-v3-json",
          [PREVIOUS_STATE_KEY]: "persisted-state-v2-json",
          [LEGACY_PLOTS_KEY]: "legacy-plot-drafts-v1-json",
        };
        const quarantinedAt = new Date().toISOString();
        const additions = found
          .filter(({ sourceKey, rawValue }) =>
            !existing.entries.some(
              (entry) => entry.sourceKey === sourceKey && entry.rawValue === rawValue,
            )
          )
          .map(({ sourceKey, rawValue }) => ({
            sourceKey,
            format: formats[sourceKey],
            rawValue,
            quarantinedAt,
          }));

        await storage.setItem(LEGACY_QUARANTINE_KEY, JSON.stringify({
          version: 1,
          entries: [...existing.entries, ...additions],
        }));
        await Promise.all(found.map(({ sourceKey }) => storage.removeItem(sourceKey)));
      })().catch((error: unknown) => {
        quarantineRun = null;
        throw error;
      });
    }
    return quarantineRun;
  }

  return {
    async loadState(scope: StateScope): Promise<PersistedState> {
      await quarantineLegacyState();
      const scopeKey = getStateStorageKey(scope);
      const existing = await storage.getItem(scopeKey);
      if (existing) return JSON.parse(existing) as PersistedState;
      return emptyState();
    },

    saveState(scope: StateScope, state: PersistedState): Promise<void> {
      return storage.setItem(getStateStorageKey(scope), JSON.stringify(state));
    },
  };
}
