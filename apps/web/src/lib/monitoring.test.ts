import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/react", () => sentry);

afterEach(() => {
  vi.resetModules();
  sentry.init.mockReset();
  sentry.setUser.mockReset();
  sentry.captureException.mockReset();
  vi.unstubAllEnvs();
});

describe("web monitoring", () => {
  it("does not initialize Sentry when DSN is absent", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { initWebMonitoring, isWebMonitoringEnabled } = await import("./monitoring");
    expect(initWebMonitoring()).toBe(false);
    expect(isWebMonitoringEnabled()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initializes Sentry when DSN is present without session replay", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.com/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("VITE_SENTRY_RELEASE", "web@test");
    const { initWebMonitoring, isWebMonitoringEnabled } = await import("./monitoring");
    expect(initWebMonitoring()).toBe(true);
    expect(isWebMonitoringEnabled()).toBe(true);
    expect(sentry.init).toHaveBeenCalledOnce();
    const options = sentry.init.mock.calls[0][0];
    expect(options.dsn).toBe("https://public@example.com/1");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    expect(options.integrations).toBeUndefined();
  });
});
