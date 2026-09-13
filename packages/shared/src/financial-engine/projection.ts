/**
 * Projected-balance metrics over a canonical timeline.
 *
 * Ports `forecast_balance_metrics_from_transactions_ledger` from
 * `backend/timeline/services/ledger_section_balances.py`.
 *
 * Requires `balance_after` from `buildTimeline` / `assignCanonicalLedgerBalanceAfter`.
 * Does not re-run `running += amount`.
 */
import { addCalendarDays, compareIsoDates, isoDatePart } from "./dates";
import { centsToDollars, dollarsToCents } from "./money";
import { transactionsLedgerWalkRows } from "./timeline";
import type {
  CalculateProjectedBalancesInput,
  EngineAccountSnapshot,
  EngineTimelineRow,
  ProjectedBalanceResult,
} from "./types";

function rowDate(row: Pick<EngineTimelineRow, "date">): string {
  return isoDatePart(String(row.date));
}

function readBalanceAfterCents(row: EngineTimelineRow): bigint | null {
  if (row.balance_after == null) return null;
  return dollarsToCents(row.balance_after);
}

function afterPendingBalanceCents(
  walk: readonly EngineTimelineRow[],
  today: string,
  ledgerAnchor: bigint
): bigint {
  let afterPending = ledgerAnchor;
  for (const row of walk) {
    if (compareIsoDates(rowDate(row), today) > 0) break;
    const bal = readBalanceAfterCents(row);
    if (bal != null) afterPending = bal;
  }
  return afterPending;
}

type MetricAcc = {
  lowest: bigint;
  lowestDate: string;
  firstNegativeDate: string | null;
  firstNegativeBalance: bigint | null;
  firstBelowBufferDate: string | null;
  firstBelowBufferBalance: bigint | null;
};

function updateBalanceMetrics(
  acc: MetricAcc,
  bal: bigint,
  rd: string,
  today: string,
  endDate: string,
  minimumBuffer: bigint
): void {
  if (compareIsoDates(rd, today) < 0 || compareIsoDates(rd, endDate) > 0) return;
  if (bal < acc.lowest) {
    acc.lowest = bal;
    acc.lowestDate = rd;
  }
  if (acc.firstNegativeDate == null && bal < 0n) {
    acc.firstNegativeDate = rd;
    acc.firstNegativeBalance = bal;
  }
  if (acc.firstBelowBufferDate == null && bal < minimumBuffer) {
    acc.firstBelowBufferDate = rd;
    acc.firstBelowBufferBalance = bal;
  }
}

function rowsNeedLedgerBalanceAfter(
  rows: readonly EngineTimelineRow[],
  today: string,
  accountId: number
): boolean {
  const walk = transactionsLedgerWalkRows(rows, { accountId, today });
  return walk.some((r) => r.balance_after == null);
}

export function forecastBalanceMetricsFromTransactionsLedger(options: {
  rows: readonly EngineTimelineRow[];
  accountId: number;
  today: string;
  endDate: string;
  minimumBuffer: string;
  ledgerAnchor: string;
}): ProjectedBalanceResult {
  const { rows, accountId, today, endDate } = options;
  if (rowsNeedLedgerBalanceAfter(rows, today, accountId)) {
    throw new Error(
      `canonical balance_after missing for account=${accountId}; forecast metrics must not reassign balances`
    );
  }

  const walk = transactionsLedgerWalkRows(rows, { accountId, today, endDate });
  const opening = dollarsToCents(options.ledgerAnchor);
  const minimumBuffer = dollarsToCents(options.minimumBuffer);
  const afterPending = afterPendingBalanceCents(walk, today, opening);

  const acc: MetricAcc = {
    lowest: opening,
    lowestDate: today,
    firstNegativeDate: opening < 0n ? today : null,
    firstNegativeBalance: opening < 0n ? opening : null,
    firstBelowBufferDate: opening < minimumBuffer ? today : null,
    firstBelowBufferBalance: opening < minimumBuffer ? opening : null,
  };

  let lastMetricDate: string | null = null;
  let balanceBeforeRow = afterPending;
  let firstNegativeTransactionId: number | null = null;

  const applyGap = (fromInclusive: string, untilExclusive: string) => {
    let gap = fromInclusive;
    while (compareIsoDates(gap, untilExclusive) < 0) {
      updateBalanceMetrics(acc, balanceBeforeRow, gap, today, endDate, minimumBuffer);
      gap = addCalendarDays(gap, 1);
    }
  };

  for (const row of walk) {
    const rd = rowDate(row);
    if (compareIsoDates(rd, today) < 0) {
      const bal = readBalanceAfterCents(row);
      if (bal != null) balanceBeforeRow = bal;
      continue;
    }
    if (compareIsoDates(rd, endDate) > 0) break;

    if (lastMetricDate == null && compareIsoDates(rd, today) > 0) {
      applyGap(today, rd);
    } else if (lastMetricDate != null && compareIsoDates(rd, addCalendarDays(lastMetricDate, 1)) > 0) {
      applyGap(addCalendarDays(lastMetricDate, 1), rd);
    }

    const bal = readBalanceAfterCents(row);
    if (bal == null) {
      throw new Error(
        `canonical balance_after missing for account=${accountId} date=${rd} description=${JSON.stringify(row.description)}`
      );
    }
    balanceBeforeRow = bal;
    const prevFirstNegative = acc.firstNegativeDate;
    updateBalanceMetrics(acc, bal, rd, today, endDate, minimumBuffer);
    if (prevFirstNegative == null && acc.firstNegativeDate != null && row.transaction_id != null) {
      firstNegativeTransactionId = Number(row.transaction_id);
    }
    lastMetricDate = rd;
  }

  const fillFrom = lastMetricDate == null ? today : addCalendarDays(lastMetricDate, 1);
  let d = fillFrom;
  while (compareIsoDates(d, endDate) <= 0) {
    updateBalanceMetrics(acc, balanceBeforeRow, d, today, endDate, minimumBuffer);
    d = addCalendarDays(d, 1);
  }

  return {
    account_id: accountId,
    opening_balance: centsToDollars(opening),
    ending: centsToDollars(balanceBeforeRow),
    lowest: centsToDollars(acc.lowest),
    lowest_date: acc.lowestDate,
    first_negative_date: acc.firstNegativeDate,
    first_negative_balance:
      acc.firstNegativeBalance == null ? null : centsToDollars(acc.firstNegativeBalance),
    first_negative_transaction_id: firstNegativeTransactionId,
    first_below_buffer_date: acc.firstBelowBufferDate,
    first_below_buffer_balance:
      acc.firstBelowBufferBalance == null ? null : centsToDollars(acc.firstBelowBufferBalance),
  };
}

export function calculateProjectedBalances(
  input: CalculateProjectedBalancesInput
): ProjectedBalanceResult[] {
  return input.accounts.map((account: EngineAccountSnapshot) =>
    forecastBalanceMetricsFromTransactionsLedger({
      rows: input.timelineRows,
      accountId: account.id,
      today: input.startDate,
      endDate: input.endDate,
      minimumBuffer: account.minimum_buffer ?? "0.00",
      ledgerAnchor: account.posted_balance_before_pending,
    })
  );
}
