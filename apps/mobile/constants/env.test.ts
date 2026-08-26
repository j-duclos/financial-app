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

  it("rewrites localhost to LAN host on physical devices in dev", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    vi.doMock("expo-constants", () => ({
      default: {
        expoConfig: { hostUri: "192.168.1.52:8081" },
        expoGoConfig: { debuggerHost: "192.168.1.52:8081" },
      },
    }));
    vi.doMock("expo-device", () => ({ isDevice: true }));
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.stubGlobal("__DEV__", true);

    const { getApiBaseUrl } = await import("./env");
    expect(getApiBaseUrl()).toBe("http://192.168.1.52:8000");
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
});
