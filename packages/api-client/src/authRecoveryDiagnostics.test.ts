import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgotPassword } from "./api";
import {
  configureAuthRecoveryDiagnostics,
  resetAuthRecoveryDiagnosticsForTests,
  sanitizeAuthRecoveryDiagnosticText,
  shouldEnableAuthRecoveryDiagnostics,
} from "./authRecoveryDiagnostics";
import { configureApiClient, ApiError } from "./config";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("forgot-password request diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAuthRecoveryDiagnosticsForTests();
    configureApiClient({ baseUrl: "https://financial-app-1-tu0l.onrender.com" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAuthRecoveryDiagnosticsForTests();
  });

  it("does not log when diagnostics are off", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { detail: "If an account exists, email sent." }))
    );
    await forgotPassword("person@example.com");
    expect(log.mock.calls.flat().join("\n")).not.toContain("[auth-recovery]");
  });

  it("logs host, endpoint, and status without email or tokens", async () => {
    configureAuthRecoveryDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { detail: "If an account exists, email sent." }));
    vi.stubGlobal("fetch", fetchMock);
    await forgotPassword("person@example.com");
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("[auth-recovery]");
    expect(output).toContain("action=forgot-password");
    expect(output).toContain("api_host=https://financial-app-1-tu0l.onrender.com");
    expect(output).toContain("endpoint=/api/auth/forgot-password/");
    expect(output).toContain("request_started=true");
    expect(output).toContain("status=200");
    expect(output).toMatch(/duration_ms=\d+/);
    expect(output).not.toContain("person@example.com");
    expect(output).not.toMatch(/Bearer |Authorization|uid=|token=/i);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toBe("https://financial-app-1-tu0l.onrender.com/api/auth/forgot-password/");
  });

  it("logs network_failure when fetch throws before an HTTP response", async () => {
    configureAuthRecoveryDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network request failed"))
    );
    await expect(forgotPassword("person@example.com")).rejects.toThrow("Network request failed");
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("network_failure=true");
    expect(output).toContain("safe_error=Network request failed");
    expect(output).not.toContain("person@example.com");
  });

  it("still throws HTTP errors after logging status", async () => {
    configureAuthRecoveryDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { detail: "throttled" })));
    await expect(forgotPassword("person@example.com")).rejects.toBeInstanceOf(ApiError);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("status=429");
    expect(output).not.toContain("person@example.com");
  });

  it("enables tracing for development and preview, not production store builds", () => {
    expect(shouldEnableAuthRecoveryDiagnostics({ isDev: true, appEnv: "development" })).toBe(true);
    expect(shouldEnableAuthRecoveryDiagnostics({ isDev: false, appEnv: "staging" })).toBe(true);
    expect(shouldEnableAuthRecoveryDiagnostics({ isDev: false, appEnv: "production" })).toBe(false);
  });

  it("redacts emails and tokens from diagnostic text", () => {
    const raw =
      "user@example.com Authorization: Bearer eyJhbGciOi.aaa.bbb token=reset-secret password=hunter2";
    const clean = sanitizeAuthRecoveryDiagnosticText(raw);
    expect(clean).not.toContain("user@example.com");
    expect(clean).not.toContain("reset-secret");
    expect(clean).not.toContain("hunter2");
    expect(clean).not.toContain("eyJhbGciOi");
  });
});
