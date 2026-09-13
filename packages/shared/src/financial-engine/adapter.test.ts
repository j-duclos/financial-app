import { describe, expect, it, vi } from "vitest";
import { buildTimeline } from "./timeline";
import {
  applyLocalBalanceWalk,
  financialEngineRequestsAnchors,
  financialEngineTimelineRequestParams,
  parseFinancialEngineMode,
  resolveTimelineWithFinancialEngine,
} from "./adapter";
import type { ShadowTimelineResponse, ShadowTimelineRow } from "./shadow";

function row(
  partial: Partial<ShadowTimelineRow> & Pick<ShadowTimelineRow, "transaction_id" | "amount">
): ShadowTimelineRow {
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

function matchingPayload(overrides?: Partial<{ balance_after: string }>): ShadowTimelineResponse {
  const serverRow = row({
    transaction_id: 1,
    amount: "10.00",
    balance_after: overrides?.balance_after ?? "110.00",
  });
  return {
    timeline: [serverRow],
    account_summary: [{ account_id: 1, ending_balance: overrides?.balance_after ?? "110.00" }],
    engine_shadow: {
      as_of: "2026-01-20",
      accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
    },
  };
}

function skippedWalkPayload(): ShadowTimelineResponse {
  const payload = matchingPayload();
  payload.timeline[0].balance_after = null;
  if (payload.account_summary?.[0]) payload.account_summary[0].ending_balance = "0.00";
  payload.engine_shadow = {
    as_of: "2026-01-20",
    balance_walk_source: "client",
    accounts: payload.engine_shadow?.accounts ?? [],
  };
  return payload;
}

function fixtureTimeline(rowCount: number, accountCount: number): {
  timeline: ShadowTimelineRow[];
  engine_shadow: { as_of: string; accounts: { account_id: number; posted_balance_before_pending: string }[] };
} {
  const timeline: ShadowTimelineRow[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const accountId = (i % accountCount) + 1;
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
  const accounts = Array.from({ length: accountCount }, (_, i) => ({
    account_id: i + 1,
    posted_balance_before_pending: "1000.00",
  }));
  const built = buildTimeline({
    accounts: accounts.map((a) => ({
      id: a.account_id,
      posted_balance_before_pending: a.posted_balance_before_pending,
    })),
    rows: timeline,
    today: "2026-01-20",
  });
  for (let i = 0; i < timeline.length; i += 1) {
    timeline[i].balance_after = built[i].balance_after ?? null;
  }
  return { timeline, engine_shadow: { as_of: "2026-01-20", accounts } };
}

describe("parseFinancialEngineMode", () => {
  it("defaults to server and fails safe on invalid values", () => {
    expect(parseFinancialEngineMode(undefined)).toBe("server");
    expect(parseFinancialEngineMode("")).toBe("server");
    expect(parseFinancialEngineMode("nope")).toBe("server");
    expect(parseFinancialEngineMode("CLIENT")).toBe("client");
    expect(parseFinancialEngineMode("shadow")).toBe("shadow");
    expect(parseFinancialEngineMode("server")).toBe("server");
  });

  it("maps the legacy boolean shadow flag to shadow mode", () => {
    expect(parseFinancialEngineMode(undefined, true)).toBe("shadow");
    expect(parseFinancialEngineMode(undefined, "true")).toBe("shadow");
    expect(parseFinancialEngineMode(undefined, "1")).toBe("shadow");
    expect(parseFinancialEngineMode("client", "true")).toBe("client");
    expect(parseFinancialEngineMode("garbage", "true")).toBe("server");
  });

  it("requests anchors only for shadow and client", () => {
    expect(financialEngineRequestsAnchors("server")).toBe(false);
    expect(financialEngineRequestsAnchors("shadow")).toBe(true);
    expect(financialEngineRequestsAnchors("client")).toBe(true);
  });

  it("sends balance_walk=client only in client mode", () => {
    expect(financialEngineTimelineRequestParams("server")).toEqual({});
    expect(financialEngineTimelineRequestParams("shadow")).toEqual({ include_engine_shadow: true });
    expect(financialEngineTimelineRequestParams("client")).toEqual({
      include_engine_shadow: true,
      balance_walk: "client",
    });
  });
});

describe("resolveTimelineWithFinancialEngine", () => {
  it("server mode returns server rows untouched and does not run the engine", () => {
    const payload = matchingPayload();
    const buildTimelineFn = vi.fn(buildTimeline);
    const result = resolveTimelineWithFinancialEngine({
      mode: "server",
      response: payload,
      today: "2026-01-20",
      buildTimelineFn,
    });
    expect(buildTimelineFn).not.toHaveBeenCalled();
    expect(result.source).toBe("server");
    expect(result.rows).toBe(payload.timeline);
    expect(result.rows[0].balance_after).toBe("110.00");
  });

  it("shadow mode compares but returns server rows", () => {
    const payload = matchingPayload();
    const original = payload.timeline[0];
    const result = resolveTimelineWithFinancialEngine({
      mode: "shadow",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server");
    expect(result.rows).toBe(payload.timeline);
    expect(result.rows[0]).toBe(original);
    expect(result.rows[0].balance_after).toBe("110.00");
    expect(result.diagnostics.mismatches).toBe(0);
  });

  it("client mode returns local balance_after without mutating the server payload", () => {
    const payload = matchingPayload();
    const serverRow = payload.timeline[0];
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("client");
    expect(result.rows).not.toBe(payload.timeline);
    expect(result.rows[0].balance_after).toBe("110.00");
    expect(result.accountSummary?.[0].ending_balance).toBe("110.00");
    expect(serverRow.balance_after).toBe("110.00");
    expect(result.rows[0]).not.toBe(serverRow);
  });

  it("client mode uses the local walk when it matches the server", () => {
    const payload = matchingPayload();
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.rows[0].balance_after).toBe("110.00");
    expect(result.source).toBe("client");
  });

  it("parity mismatch in client mode falls back only when server balances are present", () => {
    const payload = matchingPayload({ balance_after: "999.00" });
    const first = payload.timeline[0];
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("parity_mismatch");
    expect(result.rows).toBe(payload.timeline);
    expect(result.rows[0]).toBe(first);
    expect(result.rows[0].balance_after).toBe("999.00");
    expect(result.accountSummary?.[0].ending_balance).toBe("999.00");
  });

  it("does not mix local and server balances on a multi-row mismatch when server balances exist", () => {
    const a = row({ transaction_id: 1, amount: "10.00", balance_after: "110.00" });
    const b = row({
      transaction_id: 2,
      amount: "5.00",
      date: "2026-01-22",
      description: "Bonus",
      balance_after: "999.00",
    });
    const payload = {
      timeline: [a, b],
      account_summary: [{ account_id: 1, ending_balance: "999.00" }],
      engine_shadow: {
        as_of: "2026-01-20",
        accounts: [{ account_id: 1, posted_balance_before_pending: "100.00" }],
      },
    };
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.rows[0].balance_after).toBe("110.00");
    expect(result.rows[1].balance_after).toBe("999.00");
    expect(result.rows).toBe(payload.timeline);
  });

  it("missing anchors returns server fallback", () => {
    const payload = matchingPayload();
    delete (payload as { engine_shadow?: unknown }).engine_shadow;
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("missing_anchors");
    expect(result.rows).toBe(payload.timeline);
  });

  it("invalid anchor returns server fallback", () => {
    const payload = matchingPayload();
    payload.engine_shadow.accounts[0].posted_balance_before_pending = "not-money";
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("invalid_anchor");
  });

  it("malformed money returns server fallback", () => {
    const payload = matchingPayload();
    payload.timeline[0].amount = "abc";
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("malformed_money");
    expect(result.rows[0].balance_after).toBe("110.00");
  });

  it("engine exception returns server fallback", () => {
    const payload = matchingPayload();
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
      buildTimelineFn: () => {
        throw new Error("boom");
      },
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("engine_exception");
    expect(result.rows).toBe(payload.timeline);
  });

  it("duplicate row identity returns server fallback", () => {
    const payload = matchingPayload();
    payload.timeline = [payload.timeline[0], { ...payload.timeline[0] }];
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("duplicate_row_identity");
  });

  it("unknown row type returns server fallback", () => {
    const payload = matchingPayload();
    payload.timeline[0].type = "WEIRD";
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("server-fallback");
    expect(result.diagnostics.reason).toBe("unknown_row_type");
    expect(result.rows[0].balance_after).toBe("110.00");
  });

  it("client skipped-walk payload displays local balances without server parity", () => {
    const payload = skippedWalkPayload();
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("client");
    expect(result.rows[0].balance_after).toBe("110.00");
    expect(result.accountSummary?.[0].ending_balance).toBe("110.00");
    expect(payload.timeline[0].balance_after).toBeNull();
    expect(result.diagnostics.report?.matches).toBe(true);
  });

  it("client skipped-walk does not treat null server balances as a parity fallback", () => {
    const payload = skippedWalkPayload();
    payload.engine_shadow.accounts = [];
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("missing_anchors");
    expect(result.rows[0].balance_after).toBeNull();
  });

  it("missing account on skipped-walk payload is unusable", () => {
    const payload = skippedWalkPayload();
    payload.timeline[0].account_id = 99;
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("missing_account");
  });

  it("duplicate identity on skipped-walk payload is unusable", () => {
    const payload = skippedWalkPayload();
    payload.timeline = [payload.timeline[0], { ...payload.timeline[0] }];
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("duplicate_row_identity");
  });

  it("malformed money on skipped-walk payload is unusable", () => {
    const payload = skippedWalkPayload();
    payload.timeline[0].amount = "abc";
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("malformed_money");
  });

  it("invalid date on skipped-walk payload is unusable", () => {
    const payload = skippedWalkPayload();
    payload.timeline[0].date = "2026-13-40";
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("invalid_date");
  });

  it("invalid as_of date on skipped-walk payload is unusable", () => {
    const payload = skippedWalkPayload();
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "not-a-date",
    });
    expect(result.source).toBe("unusable");
    expect(result.diagnostics.reason).toBe("invalid_date");
  });

  it("runs the engine once per response", () => {
    const payload = matchingPayload();
    const buildTimelineFn = vi.fn(buildTimeline);
    resolveTimelineWithFinancialEngine({
      mode: "client",
      response: payload,
      today: "2026-01-20",
      buildTimelineFn,
    });
    expect(buildTimelineFn).toHaveBeenCalledTimes(1);
  });

  it("does not run the engine in server mode even when anchors are present", () => {
    const payload = matchingPayload();
    const buildTimelineFn = vi.fn(buildTimeline);
    resolveTimelineWithFinancialEngine({
      mode: "server",
      response: payload,
      today: "2026-01-20",
      buildTimelineFn,
    });
    expect(buildTimelineFn).not.toHaveBeenCalled();
  });
});

describe("applyLocalBalanceWalk", () => {
  it("copies only walk-row balance_after from the local engine", () => {
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
    const local = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "100.00" }],
      rows: [past, upcoming],
      today: "2026-01-20",
    });
    const derived = applyLocalBalanceWalk([past, upcoming], local, "2026-01-20");
    expect(derived[0].balance_after).toBe("97.00");
    expect(derived[1].balance_after).toBe("110.00");
    expect(derived[0]).not.toBe(past);
  });
});

describe("financial-engine adapter performance", () => {
  it.each([
    [400, 8],
    [600, 12],
    [1000, 12],
  ])("client adapter stays cheap for %s rows / %s accounts", (rowCount, accountCount) => {
    const fixture = fixtureTimeline(rowCount, accountCount);
    for (const row of fixture.timeline) row.balance_after = null;
    const result = resolveTimelineWithFinancialEngine({
      mode: "client",
      response: {
        ...fixture,
        engine_shadow: { ...fixture.engine_shadow, balance_walk_source: "client" },
      },
      today: "2026-01-20",
    });
    expect(result.source).toBe("client");
    expect(result.diagnostics.rows).toBe(rowCount);
    expect(result.diagnostics.accounts).toBe(accountCount);
    expect(result.diagnostics.durationMs).toBeLessThan(150);
    expect(result.diagnostics.compareMs).toBeLessThan(150);
    expect(result.diagnostics.totalMs).toBeLessThan(250);
    // eslint-disable-next-line no-console
    console.log(
      `[financial-engine-perf] rows=${rowCount} accounts=${accountCount}` +
        ` duration_ms=${result.diagnostics.durationMs}` +
        ` compare_ms=${result.diagnostics.compareMs}` +
        ` total_ms=${result.diagnostics.totalMs}`
    );
  });
});
