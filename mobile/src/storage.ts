import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { AuthSession, PersistedState } from "./domain";
import {
  createScopedStateRepository,
  emptyState,
  getStateStorageKey,
  type StateScope,
} from "./scopedState";

const SESSION_KEY = "sctracker.authSession.v1";
export const LANGUAGE_STORAGE_KEY = "sctracker.language.v1";
const stateRepository = createScopedStateRepository(AsyncStorage);

export { emptyState, getStateStorageKey, type StateScope };

export function loadState(scope: StateScope): Promise<PersistedState> {
  return stateRepository.loadState(scope);
}

export function saveState(scope: StateScope, state: PersistedState): Promise<void> {
  return stateRepository.saveState(scope, state);
}

export async function loadSession(): Promise<AuthSession | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthSession;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: AuthSession): Promise<void> {
  return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function clearSession(): Promise<void> {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}
