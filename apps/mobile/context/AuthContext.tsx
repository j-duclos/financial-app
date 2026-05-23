import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  configureApiClient,
  login as apiLogin,
  refreshToken,
  register as apiRegister,
  getProfile,
} from "@budget-app/api-client";

const ACCESS_KEY = "budget_access";
const REFRESH_KEY = "budget_refresh";

type AuthState = {
  access: string | null;
  refresh: string | null;
  user: { id: number; username: string } | null;
  loading: boolean;
};

const AuthContext = createContext<{
  auth: AuthState;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    access: null,
    refresh: null,
    user: null,
    loading: true,
  });
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);

  useEffect(() => {
    accessRef.current = auth.access;
    refreshRef.current = auth.refresh;
    const baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
    configureApiClient({
      baseUrl,
      getAccessToken: () => accessRef.current,
      getRefreshToken: () => refreshRef.current,
      setAccessToken: (access: string) => {
        accessRef.current = access;
        void AsyncStorage.setItem(ACCESS_KEY, access);
        setAuth((prev) => ({ ...prev, access }));
      },
    });
  }, [auth.access, auth.refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [access, refresh] = await Promise.all([
          AsyncStorage.getItem(ACCESS_KEY),
          AsyncStorage.getItem(REFRESH_KEY),
        ]);
        if (!cancelled) {
          setAuth((prev) => ({ ...prev, access, refresh, loading: false }));
        }
      } catch {
        if (!cancelled) setAuth((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
    setAuth({ access: null, refresh: null, user: null, loading: false });
  }, []);

  const setTokens = useCallback(async (access: string, refresh: string) => {
    await AsyncStorage.multiSet([[ACCESS_KEY, access], [REFRESH_KEY, refresh]]);
    setAuth((prev) => ({ ...prev, access, refresh }));
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await apiLogin(username, password);
      await setTokens(res.access, res.refresh);
      setAuth((prev) => ({ ...prev, user: (res as { user?: { id: number; username: string } }).user ?? { id: 0, username } }));
    },
    [setTokens]
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      const res = await apiRegister({ username, password, email });
      await setTokens(res.access, res.refresh);
      setAuth((prev) => ({ ...prev, user: res.user ?? { id: 0, username } }));
    },
    [setTokens]
  );

  const value = useMemo(() => ({ auth, login, register, logout }), [auth, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
