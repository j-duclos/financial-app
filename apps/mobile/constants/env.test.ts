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

  it("keeps explicit localhost URL in development", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { extra: { appEnv: "development" } } },
    }));
    vi.doMock("expo-device", () => ({ isDevice: true }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await import("./env");
    resetApiBaseUrlCacheForTests();
    expect(getApiBaseUrl()).toBe("http://localhost:8000");
  });

  it("keeps explicit non-localhost URL", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://financial-app-1-tu0l.onrender.com";
    vi.doMock("expo-constants", () => ({ default: {} }));
    vi.doMock("expo-device", () => ({ isDevice: true }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl } = await import("./env");
    expect(getApiBaseUrl()).toBe("https://financial-app-1-tu0l.onrender.com");
  });

  it("throws when production env uses localhost", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { extra: { appEnv: "production" } } },
    }));
    vi.doMock("expo-device", () => ({ isDevice: false }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await import("./env");
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/local or private-network/i);
  });

  it("throws when staging env uses plain HTTP", async () => {
    process.env.EXPO_PUBLIC_APP_ENV = "staging";
    process.env.EXPO_PUBLIC_API_URL = "http://api.example.com";
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { extra: { appEnv: "staging" } } },
    }));
    vi.doMock("expo-device", () => ({ isDevice: false }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await import("./env");
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/HTTPS/i);
  });

  it("throws when production has no API URL configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { extra: { appEnv: "production", apiUrl: "" } } },
    }));
    vi.doMock("expo-device", () => ({ isDevice: false }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", false);

    const { getApiBaseUrl, resetApiBaseUrlCacheForTests } = await import("./env");
    resetApiBaseUrlCacheForTests();
    expect(() => getApiBaseUrl()).toThrow(/not configured/i);
  });
});
