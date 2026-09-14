import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("getApiBaseUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  async function loadEnv(mocks?: {
    appEnv?: string;
    apiUrl?: string;
    hostUri?: string;
  }) {
    vi.doMock("expo-constants", () => ({
      default: {
        expoConfig: {
          hostUri: mocks?.hostUri,
          extra: {
            appEnv: mocks?.appEnv,
            apiUrl: mocks?.apiUrl ?? "",
          },
        },
      },
    }));
    return import("./env");
  }

  it("reads explicit localhost URL in development", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests, getApiTargetLabel } = await loadEnv({
      appEnv: "development",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://localhost:8000");
    expect(getApiTargetLabel()).toBe("local");
  });

  it("keeps explicit Render URL and labels it render", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://financial-app-1-tu0l.onrender.com";
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests, getApiTargetLabel } = await loadEnv();
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("https://financial-app-1-tu0l.onrender.com");
    expect(getApiTargetLabel()).toBe("render");
  });

  it("in development falls back to the Android emulator API URL when env is empty", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://10.0.2.2:8000");
  });

  it("in development derives LAN API URL from Metro hostUri when env is empty", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "",
      hostUri: "192.168.1.174:8081",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://192.168.1.174:8000");
  });

  it("maps Android emulator loopback hostUri to 10.0.2.2", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "",
      hostUri: "127.0.0.1:8081",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://10.0.2.2:8000");
  });

  it("uses extra.apiUrl when process env is empty", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "http://192.168.1.174:8000",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://192.168.1.174:8000");
  });

  it("getApiConnectivityHint includes the resolved URL in development", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiConnectivityHint, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiConnectivityHint()).toMatch(/http:\/\/10\.0\.2\.2:8000/);
  });

  it("throws when production env uses localhost", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "production",
    });
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/local or private-network/i);
  });

  it("throws when staging env uses plain HTTP", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "staging";
    process.env.EXPO_PUBLIC_API_URL = "http://api.example.com";
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "staging",
    });
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/HTTPS/i);
  });

  it("throws when production has no API URL configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "production",
      apiUrl: "",
    });
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });

  it("strips trailing slash", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://financial-app-1-tu0l.onrender.com/";
    process.env.EXPO_PUBLIC_APP_ENV = "staging";
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "staging",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("https://financial-app-1-tu0l.onrender.com");
  });

  it("does not rewrite localhost to LAN for physical devices", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
    });
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://localhost:8000");
  });

  it("keeps financial-engine mode at server unless explicitly enabled", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    delete process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_SHADOW;
    delete process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_MODE;
    vi.stubGlobal("__DEV__", true);
    const disabled = await loadEnv();
    expect(disabled.getFinancialEngineMode()).toBe("server");
    expect(disabled.isFinancialEngineShadowEnabled()).toBe(false);

    vi.resetModules();
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_SHADOW = "true";
    const shadow = await loadEnv();
    expect(shadow.getFinancialEngineMode()).toBe("shadow");

    vi.resetModules();
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_MODE = "client";
    const client = await loadEnv();
    expect(client.getFinancialEngineMode()).toBe("client");

    vi.resetModules();
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_MODE = "nope";
    const invalid = await loadEnv();
    expect(invalid.getFinancialEngineMode()).toBe("server");
  });
});

describe("wireApiClient uses centralized URL", () => {
  it("services/api.ts configures shared client from getApiBaseUrl only", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../services/api.ts"),
      "utf8"
    );
    expect(source).toMatch(/baseUrl:\s*getApiBaseUrl\(\)/);
    expect(source).not.toMatch(/localhost:8000/);
    expect(source).not.toMatch(/onrender\.com/);
    expect(source).toMatch(/configurePerfLogging\(true,\s*getApiTargetLabel\(\)\)/);
    expect(source).toMatch(/configureBillingCheckoutDiagnostics\(true\)/);
    expect(source).toMatch(/shouldEnableBillingCheckoutDiagnostics/);
  });
});

describe("production API host + runtime diagnostic", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  async function loadEnv(mocks?: { appEnv?: string; apiUrl?: string }) {
    vi.doMock("expo-constants", () => ({
      default: {
        expoConfig: {
          extra: {
            appEnv: mocks?.appEnv,
            apiUrl: mocks?.apiUrl ?? "",
          },
        },
      },
    }));
    return import("./env");
  }

  it("resolves production builds to the authoritative Render host", async () => {
    const { PRODUCTION_RENDER_ORIGIN, PRODUCTION_RENDER_HOST } = await import(
      "@budget-app/shared"
    );
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = PRODUCTION_RENDER_ORIGIN;
    vi.stubGlobal("__DEV__", false);

    const env = await loadEnv({ appEnv: "production" });
    env.resetApiBaseUrlCacheForTests();
    expect(env.getApiBaseUrl()).toBe(PRODUCTION_RENDER_ORIGIN);
    const diagnostic = env.getApiRuntimeDiagnostic();
    expect(diagnostic.environment).toBe("production");
    expect(diagnostic.resolved_api_host).toBe(PRODUCTION_RENDER_HOST);
    expect(diagnostic.build_profile).toBe("production");
    expect(env.formatApiRuntimeDiagnostic(diagnostic)).not.toMatch(
      /Bearer |Authorization|sk_live_|whsec_/
    );
  });

  it("rejects the stale Render host in staging/production", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "https://financial-app-5ywr.onrender.com";
    vi.stubGlobal("__DEV__", false);

    const env = await loadEnv({ appEnv: "production" });
    env.resetApiBaseUrlCacheForTests();
    expect(() => env.getApiBaseUrl()).toThrow(/retired Render host/i);
  });

  it("logs runtime diagnostics in development and preview, not production", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    vi.stubGlobal("__DEV__", true);
    const env = await loadEnv({ appEnv: "development" });
    env.resetApiBaseUrlCacheForTests();
    expect(env.shouldLogApiRuntimeDiagnostic(true, "development")).toBe(true);
    expect(env.shouldLogApiRuntimeDiagnostic(false, "staging")).toBe(true);
    expect(env.shouldLogApiRuntimeDiagnostic(false, "production")).toBe(false);
  });
});
