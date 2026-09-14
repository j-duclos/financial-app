import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "./api";
import {
  configureBillingCheckoutDiagnostics,
  resetBillingCheckoutDiagnosticsForTests,
  sanitizeBillingDiagnosticText,
  shouldEnableBillingCheckoutDiagnostics,
} from "./billingCheckoutDiagnostics";
import { configureApiClient, ApiError } from "./config";

function jsonResponse(
  status: number,
  body: unknown,
  contentType = "application/json"
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

describe("billing checkout diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetBillingCheckoutDiagnosticsForTests();
    configureApiClient({ baseUrl: "https://financial-app-1-tu0l.onrender.com" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBillingCheckoutDiagnosticsForTests();
  });

  it("does not log checkout diagnostics when the flag is off", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { url: "https://checkout.stripe.com/c/pay/cs_test", session_id: "cs_test" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await createCheckoutSession();
    expect(log.mock.calls.flat().join("\n")).not.toContain("[billing-checkout]");
  });

  it("logs the resolved host and status in development diagnostics", async () => {
    configureBillingCheckoutDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { url: "https://checkout.stripe.com/c/pay/cs_test", session_id: "cs_test" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await createCheckoutSession();
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("[billing-checkout]");
    expect(output).toContain("api_host=financial-app-1-tu0l.onrender.com");
    expect(output).toContain("endpoint=/api/billing/create-checkout-session/");
    expect(output).toContain("request_started=true");
    expect(output).toContain("status=200");
    expect(output).toMatch(/duration_ms=\d+/);
    expect(output).not.toMatch(/Bearer /);
    expect(output).not.toMatch(/sk_live_|sk_test_|whsec_/);
  });

  it("logs network_failure when fetch throws before an HTTP response", async () => {
    configureBillingCheckoutDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network request failed"))
    );
    await expect(createCheckoutSession()).rejects.toThrow("Network request failed");
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("network_failure=true");
    expect(output).toContain("safe_error=Network request failed");
    expect(output).not.toMatch(/Authorization|Bearer /);
  });

  it("enables tracing for development and preview, not production store builds", () => {
    expect(shouldEnableBillingCheckoutDiagnostics({ isDev: true, appEnv: "development" })).toBe(true);
    expect(shouldEnableBillingCheckoutDiagnostics({ isDev: false, appEnv: "staging" })).toBe(true);
    expect(shouldEnableBillingCheckoutDiagnostics({ isDev: false, appEnv: "production" })).toBe(false);
  });

  it("logs HTTP status without secrets when checkout returns 503 HTML", async () => {
    configureBillingCheckoutDiagnostics(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const html = "<!doctype html><html><body>Gateway Timeout Authorization: Bearer eyJhbGciOi.aaa.bbb sk_live_SECRET whsec_SECRET</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 503,
        ok: false,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
        },
        text: async () => html,
      } as Response)
    );
    await expect(createCheckoutSession()).rejects.toBeInstanceOf(ApiError);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("status=503");
    expect(output).not.toContain("sk_live_SECRET");
    expect(output).not.toContain("whsec_SECRET");
    expect(output).not.toContain("Bearer eyJ");
  });

  it("redacts tokens and Stripe secrets from diagnostic text", () => {
    const raw =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb access_token=tok_123 refresh_token=ref_456 sk_live_abc123 sk_test_def456 whsec_zzz";
    const clean = sanitizeBillingDiagnosticText(raw);
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(clean).not.toContain("tok_123");
    expect(clean).not.toContain("ref_456");
    expect(clean).not.toContain("sk_live_abc123");
    expect(clean).not.toContain("sk_test_def456");
    expect(clean).not.toContain("whsec_zzz");
    expect(clean).toContain("[redacted]");
  });
});
