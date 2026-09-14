import { useEffect, useState } from "react";
import {
  configureApiSession,
  login as apiLogin,
  logout as apiLogout,
  refreshSession,
  selectOrganization as apiSelectOrganization,
} from "../api";
import type { AuthSession } from "../domain";
import { clearSession, loadSession, saveSession } from "../storage";

export function useAuthController() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const persist = async (next: AuthSession | null) => {
      if (!active) return;
      setSession(next);
      if (next) await saveSession(next);
      else await clearSession();
    };
    configureApiSession(null, persist);
    void loadSession()
      .then(async (stored) => {
        if (!active) return;
        configureApiSession(stored, persist);
        setSession(stored);
        if (stored && Date.parse(stored.accessTokenExpiresAt) <= Date.now() + 15_000) {
          try {
            await refreshSession();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            try {
              await persist(null);
            } catch (persistenceError) {
              setError(
                persistenceError instanceof Error
                  ? persistenceError.message
                  : String(persistenceError),
              );
            }
          }
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(email: string, password: string, organizationSlug?: string) {
    setBusy(true);
    setError(null);
    try {
      await apiLogin(email.trim(), password, organizationSlug?.trim() || undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await apiLogout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function selectOrganization(organizationId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSelectOrganization(organizationId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  return { session, ready, busy, error, login, logout, selectOrganization };
}
