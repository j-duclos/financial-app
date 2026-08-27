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
  }) {
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

  it("throws when API URL is missing in development", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await loadEnv({
      appEnv: "development",
      apiUrl: "",
    });
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/EXPO_PUBLIC_API_URL is not configured/i);
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
  });
});
