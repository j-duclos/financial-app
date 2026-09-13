import { describe, expect, it, vi } from "vitest";
import { buildTimeline } from "./timeline";
import {
  compareTimelineParity,
  isFinancialEngineShadowEnabled,
  observeFinancialEngineShadow,
  shadowRowId,
  type ShadowTimelineRow,
} from "./shadow";

function row(partial: Partial<ShadowTimelineRow> & Pick<ShadowTimelineRow, "transaction_id" | "amount">): ShadowTimelineRow {
  return {
    account_id: 1,
    date: "2026-01-21",
    type: "INFLOW",
    status: "PLANNED",
    source: "rule",
    description: "Paycheck",
    financially_active: true,
    ...partial,
  };
}

describe("isFinancialEngineShadowEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(isFinancialEngineShadowEnabled(undefined)).toBe(false);
    expect(isFinancialEngineShadowEnabled("false")).toBe(false);
    expect(isFinancialEngineShadowEnabled("true")).toBe(true);
    expect(isFinancialEngineShadowEnabled("1")).toBe(true);
    expect(isFinancialEngineShadowEnabled(true)).toBe(true);
  });
});

describe("compareTimelineParity", () => {
  it("matches identical server and local rows", () => {
    const server = [row({ transaction_id: 1, amount: "10.00", balance_after: "110.00" })];
    const local = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "100.00" }],
      rows: server.map((r) => ({ ...r, amount: r.amount })),
      today: "2026-01-20",
    });
    const result = compareTimelineParity(server, local);
    expect(result.matches).toBe(true);
    expect(result.orderMatches).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports a one-cent mismatch", () => {
    const server = [row({ transaction_id: 1, amount: "10.00", balance_after: "110.01" })];
    const local = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "100.00" }],
      rows: server,
      today: "2026-01-20",
    });
    const result = compareTimelineParity(server, local);
    expect(result.matches).toBe(false);
    expect(result.mismatches[0]).toMatchObject({
      reason: "balance",
      serverBalanceAfter: "110.01",
      localBalanceAfter: "110.00",
      differenceCents: "-1",
    });
  });

  it("reports a missing local row", () => {
    const server = [
      row({ transaction_id: 1, amount: "10.00", balance_after: "110.00" }),
      row({ transaction_id: 2, amount: "5.00", balance_after: "115.00" }),
    ];
    const local = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "100.00" }],
      rows: [server[0]],
      today: "2026-01-20",
    });
    const result = compareTimelineParity(server, local);
    expect(result.mismatches.some((m) => m.reason === "missing_local" && m.rowId === "txn:2")).toBe(true);
  });

  it("reports reordered rows", () => {
    const a = row({ transaction_id: 1, amount: "10.00", balance_after: "110.00", description: "A" });
    const b = row({ transaction_id: 2, amount: "5.00", balance_after: "115.00", description: "B" });
    const result = compareTimelineParity([a, b], [b, a] as never);
    expect(result.orderMatches).toBe(false);
    expect(result.mismatches.some((m) => m.reason === "order")).toBe(true);
  });

  it("treats null server balance_after as a mismatch when local assigned one", () => {
    const server = [row({ transaction_id: 1, amount: "10.00", balance_after: null })];
    const local = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "100.00" }],
      rows: server,
      today: "2026-01-20",
    });
    const result = compareTimelineParity(server, local);
    expect(result.matches).toBe(false);
    expect(result.mismatches[0]?.reason).toBe("balance");
    expect(result.mismatches[0]?.serverBalanceAfter).toBeNull();
  });

  it("compares endings across multiple accounts", () => {
    const server = [
      row({ account_id: 1, transaction_id: 1, amount: "-20.00", type: "OUTFLOW", balance_after: "80.00" }),
      row({
        account_id: 2,
        transaction_id: 2,
        amount: "20.00",
        type: "INFLOW",
        balance_after: "70.00",
        description: "In",
      }),
    ];
    const local = buildTimeline({
      accounts: [
        { id: 1, posted_balance_before_pending: "100.00" },
        { id: 2, posted_balance_before_pending: "50.00" },
      ],
      rows: server,
      today: "2026-01-20",
    });
    const result = compareTimelineParity(server, local, {
      accountSummary: [
        { account_id: 1, ending_balance: "80.00" },
        { account_id: 2, ending_balance: "70.00" },
      ],
    });
    expect(result.matches).toBe(true);
    expect(shadowRowId(server[0])).toBe("txn:1");
  });
});

describe("observeFinancialEngineShadow", () => {
  it("does not invoke the engine when disabled", () => {
    const buildTimelineFn = vi.fn(buildTimeline);
    const result = observeFinancialEngineShadow({
      enabled: false,
      response: { timeline: [row({ transaction_id: 1, amount: "1.00", balance_after: "1.00" })] },
      today: "2026-01-20",
      buildTimelineFn,
    });
    expect(result).toBeNull();
    expect(buildTimelineFn).not.toHaveBeenCalled();
  });

  it("runs the engine when enabled and keeps server rows unchanged", () => {
    const serverRow = row({ transaction_id: 1, amount: "10.00", balance_after: "110.00" });
    const response = {
      timeline: [serverRow],
      account_summary: [{ account_id: 1, ending_balance: "110.00" }],
      engine_shadow: {
        as_of: "2026-01-20",
        accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
      },
    };
    const report = observeFinancialEngineShadow({
      enabled: true,
      response,
      today: "2026-01-20",
    });
    expect(report?.matches).toBe(true);
    expect(report?.rows).toBe(1);
    expect(serverRow.balance_after).toBe("110.00");
  });

  it("logs mismatches without throwing", () => {
    const log = vi.fn();
    const report = observeFinancialEngineShadow({
      enabled: true,
      response: {
        timeline: [row({ transaction_id: 1, amount: "10.00", balance_after: "999.00" })],
        engine_shadow: {
          as_of: "2026-01-20",
          accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
        },
      },
      today: "2026-01-20",
      log,
    });
    expect(report?.matches).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain("[financial-engine-shadow]");
  });

  it("times a realistic multi-account walk", () => {
    const timeline: ShadowTimelineRow[] = [];
    for (let i = 0; i < 400; i += 1) {
      const accountId = (i % 8) + 1;
      timeline.push(
        row({
          account_id: accountId,
          transaction_id: i + 1,
          date: `2026-01-${String(21 + (i % 9)).padStart(2, "0")}`,
          amount: i % 2 === 0 ? "12.34" : "-5.00",
          type: i % 2 === 0 ? "INFLOW" : "OUTFLOW",
          description: `Row ${i}`,
          balance_after: "0.00",
        })
      );
    }
    const accounts = Array.from({ length: 8 }, (_, i) => ({
      account_id: i + 1,
      posted_balance_before_pending: "1000.00",
    }));
    const built = buildTimeline({
      accounts: accounts.map((a) => ({ id: a.account_id, posted_balance_before_pending: a.posted_balance_before_pending })),
      rows: timeline,
      today: "2026-01-20",
    });
    for (let i = 0; i < timeline.length; i += 1) {
      timeline[i].balance_after = built[i].balance_after ?? null;
    }
    const report = observeFinancialEngineShadow({
      enabled: true,
      response: { timeline, engine_shadow: { as_of: "2026-01-20", accounts } },
      today: "2026-01-20",
    });
    expect(report?.matches).toBe(true);
    expect(report?.rows).toBe(400);
    expect(report?.accounts).toBe(8);
    expect(report?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("ignores posted past rows that the walk does not assign", () => {
    const past = row({
      transaction_id: 9,
      date: "2026-01-10",
      amount: "-3.00",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      description: "Posted",
      balance_after: "97.00",
    });
    const upcoming = row({ transaction_id: 1, amount: "10.00", balance_after: "110.00" });
    const report = observeFinancialEngineShadow({
      enabled: true,
      response: {
        timeline: [past, upcoming],
        engine_shadow: {
          as_of: "2026-01-20",
          accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
        },
      },
      today: "2026-01-20",
    });
    expect(report?.matches).toBe(true);
    expect(past.balance_after).toBe("97.00");
  });
});
