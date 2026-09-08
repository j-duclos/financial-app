import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession, createPortalSession, getBillingStatus, setTestPlanOverride } from "./api";
import { configureApiClient } from "./config";
import type {
  BillingStatus,
  CheckoutSessionResponse,
  PortalSessionResponse,
  TestPlanOverrideResponse,
} from "@budget-app/shared";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

const statusPayload: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
};

describe("billing API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureApiClient({ baseUrl: "http://test.local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getBillingStatus GETs /api/billing/status/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, statusPayload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getBillingStatus()).resolves.toEqual(statusPayload);
    expect(fetchMock.mock.calls[0][0]).toBe("http://test.local/api/billing/status/");
  });

  it("createCheckoutSession POSTs without a client price id", async () => {
    const payload: CheckoutSessionResponse = {
      url: "https://checkout.stripe.com/c/pay/cs_test",
      session_id: "cs_test",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createCheckoutSession()).resolves.toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local/api/billing/create-checkout-session/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("createPortalSession POSTs /api/billing/create-portal-session/", async () => {
    const payload: PortalSessionResponse = { url: "https://billing.stripe.com/p/session/test" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createPortalSession()).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0][0]).toBe("http://test.local/api/billing/create-portal-session/");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("setTestPlanOverride POSTs /api/dev/test-plan/ with the selected plan", async () => {
    const payload: TestPlanOverrideResponse = {
      test_plan_override: "PREMIUM",
      effective_plan: "PREMIUM",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(setTestPlanOverride("PREMIUM")).resolves.toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local/api/dev/test-plan/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ plan: "PREMIUM" });
  });

  it("setTestPlanOverride can clear the override with null", async () => {
    const payload: TestPlanOverrideResponse = {
      test_plan_override: null,
      effective_plan: "FREE",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(setTestPlanOverride(null)).resolves.toEqual(payload);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ plan: null });
  });
});
