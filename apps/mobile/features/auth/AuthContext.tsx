import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  login as apiLogin,
  register as apiRegister,
  getProfile,
  type UserProfile,
} from "@budget-app/api-client";
import { wireApiClient, describeApiError } from "@/services/api";
import {
  clearTokens,
  loadTokens,
  saveTokens,
} from "@/services/secureTokenStorage";
import { hasCompleteSession, resolveSessionRestore } from "./session";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
};

type AuthState = {
  access: string | null;
  refresh: string | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  /** True while restoring tokens / validating session on launch. */
  initializing: boolean;
  isAuthenticated: boolean;
};

type AuthContextValue = {
  auth: AuthState;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function profileToUser(profile: UserProfile): AuthUser {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name || profile.username,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    access: null,
    refresh: null,
    user: null,
    profile: null,
    initializing: true,
    isAuthenticated: false,
  });

  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);

  const forceLogout = useCallback(async () => {
    await clearTokens();
    accessRef.current = null;
    refreshRef.current = null;
    setAuth({
      access: null,
      refresh: null,
      user: null,
      profile: null,
      initializing: false,
      isAuthenticated: false,
    });
  }, []);

  const applySession = useCallback(
    async (access: string, refresh: string) => {
      accessRef.current = access;
      refreshRef.current = refresh;
      await saveTokens(access, refresh);
      wireApiClient({
        getAccess: () => accessRef.current,
        getRefresh: () => refreshRef.current,
        onAccessUpdated: (next) => {
          accessRef.current = next;
          setAuth((prev) => ({ ...prev, access: next }));
        },
        onUnauthorized: () => {
          void forceLogout();
        },
      });
      const profile = await getProfile();
      setAuth({
        access,
        refresh,
        user: profileToUser(profile),
        profile,
        initializing: false,
        isAuthenticated: true,
      });
      return profile;
    },
    [forceLogout]
  );

  // Keep api-client wired whenever token refs change.
  useEffect(() => {
    wireApiClient({
      getAccess: () => accessRef.current,
      getRefresh: () => refreshRef.current,
      onAccessUpdated: (next) => {
        accessRef.current = next;
        setAuth((prev) => ({ ...prev, access: next }));
      },
      onUnauthorized: () => {
        void forceLogout();
      },
    });
  }, [forceLogout, auth.access, auth.refresh]);

  // Restore session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { access, refresh } = await loadTokens();
        if (cancelled) return;
        const stored = { access, refresh };
        if (!hasCompleteSession(stored)) {
          setAuth((prev) => ({ ...prev, initializing: false }));
          return;
        }
        accessRef.current = access;
        refreshRef.current = refresh;
        wireApiClient({
          getAccess: () => accessRef.current,
          getRefresh: () => refreshRef.current,
          onAccessUpdated: (next) => {
            accessRef.current = next;
            setAuth((prev) => ({ ...prev, access: next }));
          },
          onUnauthorized: () => {
            void forceLogout();
          },
        });
        try {
          const profile = await getProfile();
          if (cancelled) return;
          const decision = resolveSessionRestore(stored, true);
          if (decision.status !== "authenticated") {
            await forceLogout();
            return;
          }
          setAuth({
            access,
            refresh,
            user: profileToUser(profile),
            profile,
            initializing: false,
            isAuthenticated: true,
          });
        } catch {
          if (cancelled) return;
          await forceLogout();
        }
      } catch {
        if (!cancelled) {
          setAuth((prev) => ({ ...prev, initializing: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forceLogout]);

  const login = useCallback(
    async (username: string, password: string) => {
      // Ensure base URL is configured before the first auth call.
      wireApiClient({
        getAccess: () => accessRef.current,
        getRefresh: () => refreshRef.current,
        onAccessUpdated: (next) => {
          accessRef.current = next;
          setAuth((prev) => ({ ...prev, access: next }));
        },
        onUnauthorized: () => {
          void forceLogout();
        },
      });
      const res = await apiLogin(username.trim(), password);
      await applySession(res.access, res.refresh);
    },
    [applySession, forceLogout]
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      wireApiClient({
        getAccess: () => accessRef.current,
        getRefresh: () => refreshRef.current,
        onAccessUpdated: (next) => {
          accessRef.current = next;
          setAuth((prev) => ({ ...prev, access: next }));
        },
        onUnauthorized: () => {
          void forceLogout();
        },
      });
      const res = await apiRegister({ username: username.trim(), password, email });
      await applySession(res.access, res.refresh);
    },
    [applySession, forceLogout]
  );

  const logout = useCallback(async () => {
    await forceLogout();
  }, [forceLogout]);

  const refreshProfile = useCallback(async () => {
    if (!accessRef.current) return null;
    try {
      const profile = await getProfile();
      setAuth((prev) => ({
        ...prev,
        profile,
        user: profileToUser(profile),
      }));
      return profile;
    } catch (err) {
      if (__DEV__) console.warn("refreshProfile failed", describeApiError(err));
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ auth, login, register, logout, refreshProfile }),
    [auth, login, register, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
