import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { centsToDollars } from "./money";
import {
  buildTimeline,
  signedTimelineLedgerAmountCents,
  transactionsLedgerWalkRows,
} from "./timeline";
import { calculateProjectedBalances } from "./projection";
import type { EngineAccountSnapshot, EngineTimelineRowInput, ProjectedBalanceResult } from "./types";

type ParityCase = {
  id: string;
  today: string;
  endDate: string;
  accounts: EngineAccountSnapshot[];
  rows: EngineTimelineRowInput[];
  expected: {
    timeline: { transaction_id: number; balance_after: string }[];
    projections: Array<
      Pick<
        ProjectedBalanceResult,
        | "account_id"
        | "opening_balance"
        | "ending"
        | "lowest"
        | "lowest_date"
        | "first_negative_date"
        | "first_negative_balance"
        | "first_negative_transaction_id"
      >
    >;
  };
};

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/financial-engine/parity-cases.json"
);
const parity = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: ParityCase[] };

describe("financial-engine timeline walk", () => {
  it("forces OUTFLOW negative and INFLOW positive without changing stored magnitude", () => {
    expect(centsToDollars(signedTimelineLedgerAmountCents({
      account_id: 1,
      date: "2026-01-21",
      amount: "45.67",
      type: "OUTFLOW",
    }))).toBe("-45.67");
    expect(centsToDollars(signedTimelineLedgerAmountCents({
      account_id: 1,
      date: "2026-01-21",
      amount: "-12.00",
      type: "INFLOW",
    }))).toBe("12.00");
    expect(centsToDollars(signedTimelineLedgerAmountCents({
      account_id: 1,
      date: "2026-01-21",
      amount: "-8.00",
    }))).toBe("-8.00");
  });

  it("walks pending before upcoming even when pending is dated earlier", () => {
    const rows: EngineTimelineRowInput[] = [
      {
        account_id: 1,
        date: "2026-01-25",
        amount: "1.00",
        type: "INFLOW",
        status: "PLANNED",
        source: "rule",
        transaction_id: 2,
      },
      {
        account_id: 1,
        date: "2026-01-18",
        amount: "-1.00",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule",
        transaction_id: 1,
      },
    ];
    const walk = transactionsLedgerWalkRows(rows, { accountId: 1, today: "2026-01-20" });
    expect(walk.map((r) => r.transaction_id)).toEqual([1, 2]);
  });

  it("does not mutate the caller input rows", () => {
    const rows: EngineTimelineRowInput[] = [
      {
        account_id: 1,
        date: "2026-01-21",
        amount: "5.00",
        type: "INFLOW",
        status: "CLEARED",
        source: "actual",
        transaction_id: 1,
      },
    ];
    const built = buildTimeline({
      accounts: [{ id: 1, posted_balance_before_pending: "0.00" }],
      rows,
      today: "2026-01-20",
    });
    expect(rows[0]).not.toHaveProperty("balance_after");
    expect(built[0].balance_after).toBe("5.00");
  });
});

describe("financial-engine parity fixtures", () => {
  it("loads the shared JSON cases", () => {
    expect(parity.cases.map((c) => c.id).length).toBeGreaterThanOrEqual(10);
  });

  for (const fixture of parity.cases) {
    it(`matches backend expected output: ${fixture.id}`, () => {
      const timeline = buildTimeline({
        accounts: fixture.accounts,
        rows: fixture.rows,
        today: fixture.today,
      });
      const byId = new Map(
        timeline
          .filter((row) => row.transaction_id != null && row.balance_after != null)
          .map((row) => [row.transaction_id, row.balance_after])
      );
      for (const expected of fixture.expected.timeline) {
        expect(byId.get(expected.transaction_id), `${fixture.id} txn ${expected.transaction_id}`).toBe(
          expected.balance_after
        );
      }
      if (fixture.id === "inactive-row-skipped") {
        const skipped = timeline.find((row) => row.transaction_id === 16);
        expect(skipped?.balance_after).toBeUndefined();
      }

      const projections = calculateProjectedBalances({
        accounts: fixture.accounts,
        timelineRows: timeline,
        startDate: fixture.today,
        endDate: fixture.endDate,
      });
      expect(projections).toHaveLength(fixture.expected.projections.length);
      for (const expected of fixture.expected.projections) {
        const got = projections.find((p) => p.account_id === expected.account_id);
        expect(got, `${fixture.id} account ${expected.account_id}`).toMatchObject(expected);
      }
    });
  }
});
