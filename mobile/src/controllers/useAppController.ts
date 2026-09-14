import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl, getOrganizationGeofences } from "../api";
import {
  createUuid,
  type PersistedState,
  type Plot,
  type Supplier,
  type SyncConflict,
} from "../domain";
import { isLanguage, translations, type Language } from "../i18n";
import {
  getStateStorageKey,
  LANGUAGE_STORAGE_KEY,
  loadState,
  saveState,
  type StateScope,
} from "../storage";
import { synchronize } from "../sync";
import { useAuthController } from "./useAuthController";

export type Tab = "home" | "suppliers" | "plots" | "operations" | "help";

export function useAppController() {
  const auth = useAuthController();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [language, setLanguageState] = useState<Language>("de");
  const [state, setState] = useState<PersistedState | null>(null);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);
  const persistReady = useRef(false);
  const activeScopeKey = useRef<string | null>(null);
  const scopeGeneration = useRef(0);
  const t = translations[language];
  const configured = getApiBaseUrl() !== null;
  const userId = auth.session?.user.id;
  const organizationId = auth.session?.selectedOrganizationId;
  const scope = useMemo<StateScope | null>(
    () => userId && organizationId ? { userId, organizationId } : null,
    [userId, organizationId],
  );
  const scopeKey = scope ? getStateStorageKey(scope) : null;

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((storedLanguage) => {
        if (!active) return;
        if (isLanguage(storedLanguage)) setLanguageState(storedLanguage);
        setStorageError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageError(error instanceof Error ? error.message : String(error));
      });
    const unsubscribe = NetInfo.addEventListener((network) => {
      setOnline(Boolean(network.isConnected && network.isInternetReachable !== false));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const generation = ++scopeGeneration.current;
    persistReady.current = false;
    activeScopeKey.current = null;
    setState(null);
    setSyncing(false);
    setSyncError(null);
    setGeofenceError(null);
    if (!scope || !scopeKey) return;
    let active = true;
    void loadState(scope)
      .then((storedState) => {
        if (!active || scopeGeneration.current !== generation) return;
        activeScopeKey.current = scopeKey;
        persistReady.current = true;
        setState(storedState);
        setStorageError(null);
      })
      .catch((error: unknown) => {
        if (!active || scopeGeneration.current !== generation) return;
        setStorageError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [scope, scopeKey]);

  useEffect(() => {
    if (
      !state ||
      !scope ||
      !scopeKey ||
      !persistReady.current ||
      activeScopeKey.current !== scopeKey
    ) return;
    void saveState(scope, state)
      .then(() => setStorageError(null))
      .catch((error: unknown) => {
        setStorageError(error instanceof Error ? error.message : String(error));
      });
  }, [scope, scopeKey, state]);

  useEffect(() => {
    if (!organizationId || !online) return;
    let active = true;
    void getOrganizationGeofences()
      .then((geofences) => {
        if (!active) return;
        update((current) => ({
          ...current,
          geofences: [
            ...current.geofences.filter((item) => item.organizationId !== organizationId),
            ...geofences.map((item) => ({ ...item, organizationId })),
          ],
        }));
        setGeofenceError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGeofenceError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [organizationId, online]);

  function update(recipe: (current: PersistedState) => PersistedState) {
    setState((current) => current ? recipe(current) : current);
  }

  async function setLanguage(next: Language) {
    setLanguageState(next);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function syncNow() {
    if (!state || !scope || !scopeKey || syncing || activeScopeKey.current !== scopeKey) return;
    if (!configured) {
      setSyncError(t.sync.notConfiguredDetail);
      return;
    }
    setSyncing(true);
    setSyncError(null);
    const syncingScopeKey = scopeKey;
    const result = await synchronize(state, true, scope);
    if (activeScopeKey.current !== syncingScopeKey) return;
    setState(result.state);
    if (result.error) setSyncError(result.error.message);
    setSyncing(false);
  }

  function resolveConflict(conflict: SyncConflict, choice: "local" | "remote") {
    update((current) => {
      const selected = choice === "local" ? conflict.local : conflict.remote;
      const now = new Date().toISOString();
      const remainingOutbox = current.outbox.filter(
        (item) => item.entityType !== conflict.entityType || item.entityId !== conflict.entityId,
      );
      const base = {
        ...current,
        conflicts: current.conflicts.filter((item) => item.id !== conflict.id),
        outbox: remainingOutbox,
      };
      if (conflict.entityType === "supplier") {
        const supplier = {
          ...(selected as Supplier),
          syncStatus: choice === "local" ? "pending" as const : "synced" as const,
        };
        return {
          ...base,
          suppliers: current.suppliers.map((item) => item.id === supplier.id ? supplier : item),
          outbox: choice === "local" ? [...remainingOutbox, {
            id: createUuid(),
            idempotencyKey: createUuid(),
            entityType: "supplier" as const,
            entityId: supplier.id,
            action: "upsert" as const,
            payload: supplier,
            createdAt: now,
            attempts: 0,
          }] : remainingOutbox,
        };
      }
      const plot = {
        ...(selected as Plot),
        syncStatus: choice === "local" ? "pending" as const : "synced" as const,
      };
      return {
        ...base,
        plots: current.plots.map((item) => item.id === plot.id ? plot : item),
        outbox: choice === "local" ? [...remainingOutbox, {
          id: createUuid(),
          idempotencyKey: createUuid(),
          entityType: "plot" as const,
          entityId: plot.id,
          action: "upsert" as const,
          payload: plot,
          createdAt: now,
          attempts: 0,
        }] : remainingOutbox,
      };
    });
  }

  return useMemo(() => ({
    auth,
    activeTab,
    setActiveTab,
    language,
    setLanguage,
    state,
    update,
    online,
    syncing,
    syncError,
    storageError,
    geofenceError,
    syncNow,
    resolveConflict,
    t,
    configured,
    scopeKey,
  }), [
    auth,
    activeTab,
    language,
    state,
    online,
    syncing,
    syncError,
    storageError,
    geofenceError,
    t,
    configured,
    scopeKey,
  ]);
}

export type AppController = ReturnType<typeof useAppController>;
