import assert from "node:assert/strict";
import test from "node:test";
import {
  createScopedStateRepository,
  emptyState,
  getStateStorageKey,
  LEGACY_QUARANTINE_KEY,
  type StateScope,
  type StateStorage,
} from "./scopedState";

class MemoryStorage implements StateStorage {
  readonly values = new Map<string, string>();
  failQuarantineWrite = false;

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    if (this.failQuarantineWrite && key === LEGACY_QUARANTINE_KEY) {
      throw new Error("Quarantine write failed.");
    }
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

test("state keys isolate users and organizations during tenant switches", async () => {
  const storage = new MemoryStorage();
  const repository = createScopedStateRepository(storage);
  const scopeA: StateScope = { userId: "user-1", organizationId: "org-a" };
  const scopeB: StateScope = { userId: "user-1", organizationId: "org-b" };
  const otherUser: StateScope = { userId: "user-2", organizationId: "org-a" };
  const stateA = { ...emptyState(), cursor: "cursor-a" };
  const stateB = { ...emptyState(), cursor: "cursor-b" };

  await repository.saveState(scopeA, stateA);
  await repository.saveState(scopeB, stateB);

  assert.notEqual(getStateStorageKey(scopeA), getStateStorageKey(scopeB));
  assert.notEqual(getStateStorageKey(scopeA), getStateStorageKey(otherUser));
  assert.equal((await repository.loadState(scopeA)).cursor, "cursor-a");
  assert.equal((await repository.loadState(scopeB)).cursor, "cursor-b");
  assert.equal((await repository.loadState(otherUser)).cursor, null);
});

test("unscoped legacy values are quarantined and every authenticated scope starts empty", async () => {
  const storage = new MemoryStorage();
  const repository = createScopedStateRepository(storage);
  const firstScope: StateScope = { userId: "user-1", organizationId: "org-a" };
  const secondScope: StateScope = { userId: "user-1", organizationId: "org-b" };
  const legacyValues = {
    "sctracker.mobileState.v3": JSON.stringify({ ...emptyState(), cursor: "legacy-v3" }),
    "sctracker.mobileState.v2": '{"version":2,"cursor":"legacy-v2"}',
    "sctracker.plotDrafts.v1": '[{"producer":"Legacy producer"}]',
  };
  for (const [key, value] of Object.entries(legacyValues)) {
    storage.values.set(key, value);
  }

  assert.equal((await repository.loadState(firstScope)).cursor, null);
  assert.equal((await repository.loadState(secondScope)).cursor, null);
  for (const key of Object.keys(legacyValues)) {
    assert.equal(storage.values.has(key), false);
  }
  const quarantine = JSON.parse(storage.values.get(LEGACY_QUARANTINE_KEY)!) as {
    version: number;
    entries: Array<{ sourceKey: string; format: string; rawValue: string }>;
  };
  assert.equal(quarantine.version, 1);
  assert.deepEqual(
    quarantine.entries.map(({ sourceKey, format, rawValue }) => ({
      sourceKey,
      format,
      rawValue,
    })),
    [
      {
        sourceKey: "sctracker.mobileState.v3",
        format: "persisted-state-v3-json",
        rawValue: legacyValues["sctracker.mobileState.v3"],
      },
      {
        sourceKey: "sctracker.mobileState.v2",
        format: "persisted-state-v2-json",
        rawValue: legacyValues["sctracker.mobileState.v2"],
      },
      {
        sourceKey: "sctracker.plotDrafts.v1",
        format: "legacy-plot-drafts-v1-json",
        rawValue: legacyValues["sctracker.plotDrafts.v1"],
      },
    ],
  );
});

test("active legacy keys remain when quarantine persistence fails", async () => {
  const storage = new MemoryStorage();
  const repository = createScopedStateRepository(storage);
  const legacyKey = "sctracker.mobileState.v3";
  storage.values.set(legacyKey, '{"version":3}');
  storage.failQuarantineWrite = true;

  await assert.rejects(
    () => repository.loadState({ userId: "user-1", organizationId: "org-a" }),
    /Quarantine write failed/,
  );

  assert.equal(storage.values.get(legacyKey), '{"version":3}');
  assert.equal(storage.values.has(LEGACY_QUARANTINE_KEY), false);
});
