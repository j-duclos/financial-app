import { describe, expect, it, vi, beforeEach } from "vitest";
import { FinancialEngineUnusablePayloadError } from "@budget-app/shared";
import { getTimelineWithEngineShadow } from "./financialEngineShadow";

const getTimeline = vi.fn();

vi.mock("@budget-app/api-client", () => ({
  getTimeline: (...args: unknown[]) => getTimeline(...args),
}));

const matchingServer = {
  timeline: [
    {
      account_id: 1,
      date: "2026-01-21",
      amount: "10.00",
      type: "INFLOW",
      status: "PLANNED",
      source: "rule",
      description: "Paycheck",
      transaction_id: 1,
      balance_after: "110.00",
      financially_active: true,
    },
  ],
  account_summary: [{ account_id: 1, account_name: "Checking", ending_balance: "110.00" }],
  engine_shadow: {
    as_of: "2026-01-20",
    balance_walk_source: "server",
    accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
  },
};

const skippedServer = {
  timeline: [{ ...matchingServer.timeline[0], balance_after: null }],
  account_summary: [{ ...matchingServer.account_summary[0], ending_balance: "0.00" }],
  engine_shadow: {
    ...matchingServer.engine_shadow,
    balance_walk_source: "client",
  },
};

describe("mobile financial-engine wrapper", () => {
  beforeEach(() => {
    getTimeline.mockReset();
  });

  it("server mode does not request include_engine_shadow or balance_walk", async () => {
    getTimeline.mockResolvedValue(matchingServer);
    const data = await getTimelineWithEngineShadow(
      { start: "2026-01-20", end: "2026-02-20", as_of: "2026-01-20", account_id: 1 },
      { mode: "server" }
    );
    expect(getTimeline).toHaveBeenCalledTimes(1);
    const request = getTimeline.mock.calls[0][0];
    expect(request).toEqual(expect.objectContaining({ account_id: 1 }));
    expect(request).not.toHaveProperty("include_engine_shadow");
    expect(request).not.toHaveProperty("balance_walk");
    expect(data.timeline[0].balance_after).toBe("110.00");
    expect(data).toBe(matchingServer);
  });

  it("shadow mode requests anchors but still renders server values", async () => {
    getTimeline.mockResolvedValue(matchingServer);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = await getTimelineWithEngineShadow(
      { start: "2026-01-20", end: "2026-02-20", as_of: "2026-01-20", account_id: 1 },
      { mode: "shadow" }
    );
    expect(getTimeline).toHaveBeenCalledWith(expect.objectContaining({ include_engine_shadow: true }));
    expect(getTimeline.mock.calls[0][0]).not.toHaveProperty("balance_walk");
    expect(data.timeline[0].balance_after).toBe("110.00");
    expect(data).toBe(matchingServer);
  });

  it("client mode requests skipped walk and renders local values", async () => {
    getTimeline.mockResolvedValue(skippedServer);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const data = await getTimelineWithEngineShadow(
      { start: "2026-01-20", end: "2026-02-20", as_of: "2026-01-20", account_id: 1 },
      { mode: "client" }
    );
    expect(getTimeline).toHaveBeenCalledTimes(1);
    expect(getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ include_engine_shadow: true, balance_walk: "client" })
    );
    expect(data.timeline[0].balance_after).toBe("110.00");
    expect(data).not.toBe(skippedServer);
  });

  it("client mode falls back to the full server timeline only when server balances exist", async () => {
    const mismatched = {
      ...matchingServer,
      timeline: [{ ...matchingServer.timeline[0], balance_after: "999.00" }],
      account_summary: [{ ...matchingServer.account_summary[0], ending_balance: "999.00" }],
    };
    getTimeline.mockResolvedValue(mismatched);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const data = await getTimelineWithEngineShadow(
      { start: "2026-01-20", end: "2026-02-20", as_of: "2026-01-20", account_id: 1 },
      { mode: "client" }
    );
    expect(data).toBe(mismatched);
    expect(data.timeline[0].balance_after).toBe("999.00");
  });

  it("client mode throws when skipped-walk payload is structurally unusable", async () => {
    getTimeline.mockResolvedValue({
      ...skippedServer,
      engine_shadow: { ...skippedServer.engine_shadow, accounts: [] },
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      getTimelineWithEngineShadow(
        { start: "2026-01-20", end: "2026-02-20", as_of: "2026-01-20", account_id: 1 },
        { mode: "client" }
      )
    ).rejects.toBeInstanceOf(FinancialEngineUnusablePayloadError);
  });
});
