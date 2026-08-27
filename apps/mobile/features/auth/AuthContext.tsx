import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  login as apiLogin,
  register as apiRegister,
  getProfile,
  perfLog,
  type UserProfile,
} from "@budget-app/api-client";
import { wireApiClient, describeApiError } from "@/services/api";
import {
  clearTokens,
  loadTokens,
  saveTokens,
} from "@/services/secureTokenStorage";
import { clearUserQueryCache } from "@/lib/clearUserQueryCache";
import { PROFILE_QUERY_KEY, PROFILE_STALE_MS } from "@/lib/profileQueryKey";
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
  /** Convenience mirror of React Query `["profile"]` — may be null briefly after restore. */
  profile: UserProfile | null;
  /** True while reading SecureStore and wiring the API client on launch. */
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

function hydrateProfileCache(
  queryClient: ReturnType<typeof useQueryClient>,
  profile: UserProfile
): void {
  queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
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
  const sessionEpochRef = useRef(0);

  const forceLogout = useCallback(async () => {
    sessionEpochRef.current += 1;
    clearUserQueryCache(queryClient);
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
  }, [queryClient]);

  const syncApiClient = useCallback(() => {
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
  }, [forceLogout]);

  const fetchAndHydrateProfile = useCallback(
    async (sessionEpoch: number): Promise<UserProfile | null> => {
      const profileStart = __DEV__ ? performance.now() : 0;
      try {
        const profile = await queryClient.fetchQuery({
          queryKey: PROFILE_QUERY_KEY,
          queryFn: getProfile,
          staleTime: PROFILE_STALE_MS,
        });
        if (sessionEpoch !== sessionEpochRef.current) return null;
        hydrateProfileCache(queryClient, profile);
        setAuth((prev) => ({
          ...prev,
          user: profileToUser(profile),
          profile: prev.profile ?? profile,
        }));
        if (__DEV__) {
          perfLog(
            `[PERF] auth profile background fetch elapsed_ms=${Math.round(performance.now() - profileStart)}`
          );
        }
        return profile;
      } catch (err) {
        if (sessionEpoch !== sessionEpochRef.current) return null;
        if (__DEV__) {
          console.warn("profile fetch failed", describeApiError(err));
        }
        return null;
      }
    },
    [queryClient]
  );

  const applySession = useCallback(
    async (access: string, refresh: string) => {
      const sessionEpoch = ++sessionEpochRef.current;
      clearUserQueryCache(queryClient);
      accessRef.current = access;
      refreshRef.current = refresh;
      await saveTokens(access, refresh);
      syncApiClient();
      setAuth({
        access,
        refresh,
        user: null,
        profile: null,
        initializing: false,
        isAuthenticated: true,
      });
      return fetchAndHydrateProfile(sessionEpoch);
    },
    [fetchAndHydrateProfile, syncApiClient]
  );

  useEffect(() => {
    syncApiClient();
  }, [syncApiClient, auth.access, auth.refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restoreStart = __DEV__ ? performance.now() : 0;
      try {
        const { access, refresh } = await loadTokens();
        if (__DEV__) {
          perfLog(
            `[PERF] auth SecureStore restore elapsed_ms=${Math.round(performance.now() - restoreStart)}`
          );
        }
        if (cancelled) return;

        const stored = { access, refresh };
        const decision = resolveSessionRestore(stored);
        if (decision.status !== "authenticated") {
          setAuth((prev) => ({ ...prev, initializing: false }));
          return;
        }

        const sessionEpoch = sessionEpochRef.current;
        accessRef.current = decision.access;
        refreshRef.current = decision.refresh;
        syncApiClient();
        setAuth({
          access: decision.access,
          refresh: decision.refresh,
          user: null,
          profile: null,
          initializing: false,
          isAuthenticated: true,
        });
        if (__DEV__) {
          perfLog(
            `[PERF] auth shell ready elapsed_ms=${Math.round(performance.now() - restoreStart)}`
          );
        }
        void fetchAndHydrateProfile(sessionEpoch);
      } catch {
        if (!cancelled) {
          setAuth((prev) => ({ ...prev, initializing: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAndHydrateProfile, syncApiClient]);

  const login = useCallback(
    async (username: string, password: string) => {
      syncApiClient();
      const res = await apiLogin(username.trim(), password);
      await applySession(res.access, res.refresh);
    },
    [applySession, syncApiClient]
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      syncApiClient();
      const res = await apiRegister({ username: username.trim(), password, email });
      await applySession(res.access, res.refresh);
    },
    [applySession, syncApiClient]
  );

  const logout = useCallback(async () => {
    await forceLogout();
  }, [forceLogout]);

  const refreshProfile = useCallback(async () => {
    if (!accessRef.current) return null;
    const sessionEpoch = sessionEpochRef.current;
    try {
      const profile = await queryClient.fetchQuery({
        queryKey: PROFILE_QUERY_KEY,
        queryFn: getProfile,
        staleTime: 0,
      });
      if (sessionEpoch !== sessionEpochRef.current) return null;
      hydrateProfileCache(queryClient, profile);
      setAuth((prev) => ({
        ...prev,
        user: profileToUser(profile),
        profile: prev.profile ?? profile,
      }));
      return profile;
    } catch (err) {
      if (__DEV__) console.warn("refreshProfile failed", describeApiError(err));
      return null;
    }
  }, [queryClient]);

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
