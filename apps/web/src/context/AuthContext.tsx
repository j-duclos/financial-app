import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  logout: () => void;
  setTokens: (access: string, refresh: string) => void;
  /** Re-fetch profile so header display name updates after Profile page save. */
  refreshUser: () => Promise<void>;
} | null>(null);

function profileLabel(profile: { username: string; display_name: string }) {
  const d = profile.display_name?.trim();
  return d ? d : profile.username;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
    user: null,
    loading: true,
  });

  const setTokens = useCallback((access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    setAuth((prev) => ({ ...prev, access, refresh }));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setAuth({ access: null, refresh: null, user: null, loading: false });
  }, []);

  useEffect(() => {
    const fromEnv =
      import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL;
    const baseUrl =
      fromEnv != null && String(fromEnv).trim() !== ""
        ? String(fromEnv).replace(/\/$/, "")
        : "";
    configureApiClient({
      baseUrl,
      getAccessToken: () => localStorage.getItem(ACCESS_KEY),
      getRefreshToken: () => localStorage.getItem(REFRESH_KEY),
      setAccessToken: (access: string) => {
        localStorage.setItem(ACCESS_KEY, access);
        setAuth((prev) => ({ ...prev, access }));
      },
    });
  }, []);

  useEffect(() => {
    if (!auth.access && !auth.refresh) {
      setAuth((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (auth.user) {
      setAuth((prev) => ({ ...prev, loading: false }));
      return;
    }
    getProfile()
      .then((profile) => {
        setAuth((prev) => ({
          ...prev,
          user: { id: profile.id, username: profileLabel(profile) },
          loading: false,
        }));
      })
      .catch(() => {
        if (auth.refresh) {
          refreshToken(auth.refresh)
            .then((r) => {
              setTokens(r.access, auth.refresh!);
              setAuth((prev) => ({ ...prev, loading: false }));
            })
            .catch(() => {
              logout();
            });
        } else {
          logout();
        }
      });
  }, [auth.access, auth.refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await apiLogin(username, password);
      setTokens(res.access, res.refresh);
      setAuth((prev) => ({ ...prev, user: (res as { user?: { id: number; username: string } }).user ?? { id: 0, username } }));
    },
    [setTokens]
  );

  const register = useCallback(
    async (username: string, password: string, email?: string) => {
      const res = await apiRegister({ username, password, email });
      setTokens(res.access, res.refresh);
      setAuth((prev) => ({ ...prev, user: res.user ?? { id: 0, username } }));
    },
    [setTokens]
  );

  const refreshUser = useCallback(async () => {
    const access = localStorage.getItem(ACCESS_KEY);
    if (!access) return;
    try {
      const profile = await getProfile();
      setAuth((prev) => ({
        ...prev,
        user: { id: profile.id, username: profileLabel(profile) },
      }));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ auth, login, register, logout, setTokens, refreshUser }),
    [auth, login, register, logout, setTokens, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
