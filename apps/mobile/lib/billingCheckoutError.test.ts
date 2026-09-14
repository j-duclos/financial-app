import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@budget-app/api-client";
import { BILLING_UNAVAILABLE_MESSAGE } from "@/lib/billing";
import {
  buildBillingCheckoutErrorDiagnostic,
  formatBillingCheckoutErrorLog,
  logBillingCheckoutErrorIfDev,
  productionUpgradeAlertUnchanged,
} from "./billingCheckoutError";

vi.mock("@/constants/env", () => ({
  getApiBaseUrl: () => "https://financial-app-1-tu0l.onrender.com",
}));

describe("billing checkout error diagnostics", () => {
  beforeEach(() => {
    vi.stubGlobal("__DEV__", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs safe diagnostic fields in development", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = new ApiError(503, "Billing is temporarily unavailable. Please try again later.", {
      contentType: "text/html",
    });
    logBillingCheckoutErrorIfDev(error);
    const output = String(log.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("[billing-checkout-error]");
    expect(output).toContain("error_type=ApiError");
    expect(output).toContain("status=503");
    expect(output).toContain("api_base_url=https://financial-app-1-tu0l.onrender.com");
    expect(output).toContain("endpoint=/api/billing/create-checkout-session/");
    expect(output).toContain("response_content_type=text/html");
    expect(output).not.toMatch(/Bearer |sk_live_|sk_test_|whsec_/);
  });

  it("does not log diagnostic detail when __DEV__ is false", () => {
    vi.stubGlobal("__DEV__", false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logBillingCheckoutErrorIfDev(new ApiError(503, "Billing is temporarily unavailable. Please try again later."));
    expect(log).not.toHaveBeenCalled();
  });

  it("redacts secrets from the diagnostic message and keeps production alert copy", () => {
    const error = new TypeError(
      "Network request failed Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb sk_live_abc whsec_zzz"
    );
    const fields = buildBillingCheckoutErrorDiagnostic(error);
    const output = formatBillingCheckoutErrorLog(fields);
    expect(output).toContain("network_error=true");
    expect(output).not.toContain("sk_live_abc");
    expect(output).not.toContain("whsec_zzz");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(productionUpgradeAlertUnchanged()).toBe(
      "Billing is temporarily unavailable. Please try again later."
    );
    expect(BILLING_UNAVAILABLE_MESSAGE).toBe(
      "Billing is temporarily unavailable. Please try again later."
    );
  });
});
