import { isPerfLoggingEnabled, perfLog } from "./perf";

let baseUrl = "";
let getAccessToken: (() => string | null) | null = null;
let getRefreshToken: (() => string | null) | null = null;
let setAccessToken: ((access: string) => void) | null = null;

/** Single flight so concurrent 401s share one refresh instead of stampeding /auth/refresh/. */
let refreshPromise: Promise<boolean> | null = null;

export function configureApiClient(options: {
  baseUrl: string;
  getAccessToken?: () => string | null;
  /** When set, expired access tokens trigger one refresh + retry on 401. */
  getRefreshToken?: () => string | null;
  /** Persist new access token (e.g. localStorage + React state). */
  setAccessToken?: (access: string) => void;
}) {
  baseUrl = options.baseUrl.replace(/\/$/, "");
  getAccessToken = options.getAccessToken ?? null;
  getRefreshToken = options.getRefreshToken ?? null;
  setAccessToken = options.setAccessToken ?? null;
}

export function getBaseUrl(): string {
  return baseUrl;
}

export function getAuthHeader(): Record<string, string> | undefined {
  const token = getAccessToken?.();
  if (token) return { Authorization: `Bearer ${token}` };
  return undefined;
}

function isPublicAuthPath(path: string): boolean {
  return path.includes("/api/auth/token/") || path.includes("/api/auth/register/");
}

async function tryRefreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken?.();
  if (!refresh || !setAccessToken) return false;

  if (!refreshPromise) {
    refreshPromise = (async (): Promise<boolean> => {
      try {
        const res = await fetch(`${baseUrl}/api/auth/refresh/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { access?: string };
        if (!data.access) return false;
        setAccessToken(data.access);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export type ApiRequestOptions = RequestInit & {
  params?: Record<string, string>;
  /** Default 90s. Plaid import/sync may need longer on Render. */
  timeoutMs?: number;
};

export async function request<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T | undefined> {
  return requestInner<T>(path, options, false);
}

async function requestInner<T>(
  path: string,
  options: ApiRequestOptions,
  didRefresh: boolean
): Promise<T | undefined> {
  const { params, timeoutMs: timeoutOverride, ...init } = options;
  let url = baseUrl + path;
  if (params && Object.keys(params).length > 0) {
    const search = new URLSearchParams(params).toString();
    url += (path.includes("?") ? "&" : "?") + search;
  }
  const isPublicAuth = isPublicAuthPath(path);
  const authHeader = !isPublicAuth ? getAuthHeader() : undefined;
  const hasBody = init.body != null && init.body !== "";
  const headers: Record<string, string> = {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(authHeader ?? {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const getOpts = (init.method ?? "GET") === "GET" ? { cache: "no-store" as RequestCache } : {};
  const timeoutMs = timeoutOverride ?? 90_000;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const method = (init.method ?? "GET").toUpperCase();
  const perfOn = isPerfLoggingEnabled();
  const perfStarted = perfOn ? performance.now() : 0;
  if (perfOn) {
    const paramStr =
      params && Object.keys(params).length > 0
        ? ` params=${JSON.stringify(params)}`
        : "";
    perfLog(`[PERF] api START ${method} ${path}${paramStr}`);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, ...getOpts, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        504,
        `Request timed out after ${Math.round(timeoutMs / 1000)}s — the server may be overloaded. Try again or narrow the date range.`
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (perfOn) {
    const elapsedMs = Math.round(performance.now() - perfStarted);
    perfLog(`[PERF] api END ${method} ${path} status=${res.status} elapsed_ms=${elapsedMs}`);
  }

  if (res.status === 401 && !didRefresh && !isPublicAuth && getRefreshToken && setAccessToken) {
    const refreshed = await tryRefreshAccessToken();
    if (refreshed) {
      return requestInner<T>(path, options, true);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      const j = JSON.parse(text) as Record<string, unknown> & {
        detail?: unknown;
        message?: string;
        redirect_uri_sent?: string;
      };
      const detailStr =
        typeof j.detail === "string"
          ? j.detail
          : Array.isArray(j.detail) && j.detail.every((x) => typeof x === "string")
            ? (j.detail as string[]).join(" ")
            : undefined;
      const fieldParts: string[] = [];
      for (const [key, val] of Object.entries(j)) {
        if (key === "detail" || key === "message" || key === "redirect_uri_sent") continue;
        if (Array.isArray(val) && val.every((x) => typeof x === "string"))
          fieldParts.push(`${key}: ${(val as string[]).join(" ")}`);
        else if (typeof val === "string") fieldParts.push(`${key}: ${val}`);
      }
      const fieldStr = fieldParts.length > 0 ? fieldParts.join("; ") : "";
      detail = detailStr ?? j.message ?? fieldStr ?? text;
      if (typeof j.redirect_uri_sent === "string" && j.redirect_uri_sent.trim() !== "") {
        detail = `${detail}\n\nPlaid allowlist — add this exact URL (Developers → API): ${j.redirect_uri_sent.trim()}`;
      }
    } catch {
      detail = text;
    }
    throw new ApiError(res.status, detail);
  }
  if ((init.method ?? "").toUpperCase() === "DELETE" && res.status !== 204) {
    throw new ApiError(res.status, "Delete must return 204; got " + res.status + " — is VITE_API_URL pointing at the backend?");
  }
  if (res.status === 204) return;
  return res.json();
}

/** Like request() but throws if response is 204/empty (use for endpoints that return JSON). */
export async function requestRequired<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const r = await request<T>(path, options);
  if (r === undefined) throw new ApiError(204, "No content");
  return r;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
