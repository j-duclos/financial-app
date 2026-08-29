import type {
  DashboardUpcomingGroup,
  DashboardUpcomingTransaction,
  DayHeatLevel,
  TimelineCalendarDay,
  TimelineCalendarTransaction,
} from "./types";
import { dayHeatEmoji, resolveDayHeatLevel } from "./dayHeatDisplay";
import { formatCurrency } from "./utils";
import {
  groupItemsByMonth,
  monthKeyFromIsoDate,
  monthLabelFromIsoDate,
  monthLabelFromKey,
  type MonthGroup,
} from "./monthGroupDisplay";

/** Calendar page route (nav label is "Calendar"; path remains /timeline). */
export const UPCOMING_CALENDAR_PATH = "/timeline";

export const UPCOMING_SECTION_TITLE = "Upcoming Money Flow";

export const UPCOMING_PAGE_TITLE = "Money Flow Calendar";

/** Dashboard preview: next N days only. */
export const UPCOMING_PREVIEW_DAYS = 7;

/** Dashboard preview: max transaction rows across all preview days. */
export const UPCOMING_PREVIEW_MAX_ITEMS = 5;

/** Dashboard preview footer — transfers do not affect household net. */
export const UPCOMING_PREVIEW_TRANSFER_FOOTER =
  "Transfers move money between your accounts and do not change household cash flow.";

export const UPCOMING_MAX_VISIBLE_TRANSACTIONS = 25;

/** Calendar page Upcoming Money Flow window (matches backend UPCOMING_DAYS). */
export const UPCOMING_CALENDAR_WINDOW_DAYS = 14;

/** Default visible rows per day before "show more" (matches backend UPCOMING_PER_DAY_VISIBLE). */
export const UPCOMING_PER_DAY_VISIBLE = 5;

export function upcomingSectionTitle(days: number): string {
  return UPCOMING_SECTION_TITLE;
}

export function upcomingSectionCollapseLabel(collapsed: boolean): string {
  return collapsed ? "Expand section" : "Collapse section";
}

export function upcomingSectionCollapsedSummary(
  groups: DashboardUpcomingGroup[],
  days: number
): string {
  if (groups.length === 0) {
    return `No upcoming activity in the next ${days} days`;
  }
  const txnCount = groups.reduce((sum, g) => sum + upcomingDayTransactionCount(g), 0);
  const dayLabel = groups.length === 1 ? "1 day" : `${groups.length} days`;
  return `${dayLabel} · ${upcomingDayTransactionSummary(txnCount)}`;
}

export function upcomingTruncatedMessage(limit = UPCOMING_MAX_VISIBLE_TRANSACTIONS): string {
  return `Showing the first ${limit} upcoming transactions.`;
}

/** Dashboard preview banner — not the full calendar cap. */
export function upcomingPreviewTruncatedMessage(
  maxItems: number = UPCOMING_PREVIEW_MAX_ITEMS,
  days: number = UPCOMING_PREVIEW_DAYS,
  opts?: { itemTruncated?: boolean; dayWindowTruncated?: boolean }
): string {
  const itemTruncated = opts?.itemTruncated ?? true;
  const dayWindowTruncated = opts?.dayWindowTruncated ?? false;
  if (itemTruncated && dayWindowTruncated) {
    return `Showing up to ${maxItems} transactions in the next ${days} days.`;
  }
  if (dayWindowTruncated) {
    return `Showing the next ${days} days.`;
  }
  return `Showing up to ${maxItems} upcoming transactions.`;
}

export function upcomingTimelineLinkLabel(): string {
  return "Open Calendar";
}

export function upcomingFullTimelineLinkLabel(): string {
  return "View full timeline →";
}

export type UpcomingHeatLevel = DayHeatLevel;

export function upcomingDayHeatLevel(group: DashboardUpcomingGroup): UpcomingHeatLevel {
  return resolveDayHeatLevel(group);
}

export function upcomingHeatEmoji(level: UpcomingHeatLevel): string {
  return dayHeatEmoji(level);
}

export function upcomingMonthLabel(group: DashboardUpcomingGroup): string {
  if (group.month_label) return group.month_label;
  return monthLabelFromIsoDate(group.date);
}

export function upcomingMonthKey(group: DashboardUpcomingGroup): string {
  return group.month_key ?? monthKeyFromIsoDate(group.date);
}

export function groupUpcomingByMonth(
  groups: DashboardUpcomingGroup[]
): MonthGroup<DashboardUpcomingGroup>[] {
  return groupItemsByMonth(groups, (g) => g.date, {
    getMonthKey: (g) => upcomingMonthKey(g),
    getMonthLabel: (g) => upcomingMonthLabel(g),
  });
}

/** Sticky month separators when the list is tall or spans months (page scroll only, no nested panel). */
export function upcomingListUsesStickyScroll(groups: DashboardUpcomingGroup[]): boolean {
  if (groups.length === 0) return false;
  const monthKeys = new Set(groups.map(upcomingMonthKey));
  return groups.length > 7 || monthKeys.size > 1;
}

export function upcomingLowestBalanceLines(
  group: DashboardUpcomingGroup
): string[] {
  const rows = group.lowest_projected_balances ?? [];
  return rows.map((row) => `${row.account_name}: ${row.balance}`);
}

export function upcomingDayTransactionCount(group: DashboardUpcomingGroup): number {
  if (group.transactions.length > 0) {
    return upcomingDisplayTransactionCount(group);
  }
  return group.total_transaction_count ?? group.transactions.length;
}

export function upcomingDayCollapseLabel(collapsed: boolean): string {
  return collapsed ? "Expand Day" : "Collapse Day";
}

export function upcomingDayTransactionSummary(count: number): string {
  if (count === 0) return "No transactions";
  if (count === 1) return "1 transaction";
  return `${count} transactions`;
}

export function upcomingDayShowMoreLabel(hiddenCount: number): string {
  return `Show ${hiddenCount} more for this day`;
}

/** Days over the per-day preview limit start collapsed to reduce scroll. */
export function initialUpcomingDayCollapsed(
  groups: DashboardUpcomingGroup[],
  perDayVisible: number = UPCOMING_PER_DAY_VISIBLE
): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {};
  for (const group of groups) {
    if (upcomingDayTransactionCount(group) > perDayVisible) {
      collapsed[group.date] = true;
    }
  }
  return collapsed;
}

export function upcomingEmptyMessage(days = 14): string {
  return `No upcoming transactions in the next ${days} days.`;
}

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, "0");
  const nd = String(dt.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/** Keep groups whose date falls within [today, today + maxDays]. */
export function filterUpcomingGroupsForPreview(
  groups: DashboardUpcomingGroup[],
  maxDays: number = UPCOMING_PREVIEW_DAYS,
  today: string = todayIsoLocal()
): DashboardUpcomingGroup[] {
  const end = addDaysIso(today, maxDays);
  return groups.filter((g) => g.date >= today && g.date <= end);
}

/**
 * Trim groups to at most maxItems display transactions (post transfer collapse).
 * Returns cloned groups with shortened transaction lists when needed.
 */
export function limitUpcomingGroupsByItemCount(
  groups: DashboardUpcomingGroup[],
  maxItems: number = UPCOMING_PREVIEW_MAX_ITEMS
): { groups: DashboardUpcomingGroup[]; truncated: boolean } {
  const out: DashboardUpcomingGroup[] = [];
  let remaining = maxItems;
  let truncated = false;

  for (const group of groups) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const displayTxns = upcomingDisplayTransactions(group);
    if (displayTxns.length === 0) {
      out.push(group);
      continue;
    }
    if (displayTxns.length <= remaining) {
      out.push(group);
      remaining -= displayTxns.length;
      continue;
    }
    const keepIds = new Set(displayTxns.slice(0, remaining).map((t) => t.id));
    out.push({
      ...group,
      transactions: group.transactions.filter((t) => keepIds.has(t.id)),
    });
    remaining = 0;
    truncated = true;
  }

  if (out.length < groups.length && remaining <= 0) {
    truncated = true;
  }

  return { groups: out, truncated };
}

export type UpcomingPreviewRisk = {
  date: string;
  accountName?: string | null;
  reason?: string | null;
  projectedEndBalance?: string | null;
};

export type UpcomingPreviewTxnRow = {
  txn: DashboardUpcomingTransaction;
  isFirstZeroCross: boolean;
};

export type UpcomingPreviewDayBlock = {
  group: DashboardUpcomingGroup;
  transactions: DashboardUpcomingTransaction[];
  firstNegativeWarning: string | null;
};

export type UpcomingDashboardPreviewLayout = {
  groups: DashboardUpcomingGroup[];
  days: UpcomingPreviewDayBlock[];
  transactions: UpcomingPreviewTxnRow[];
  daysHorizon: number;
  truncated: boolean;
  truncatedMessage: string | null;
  nextRisk: UpcomingPreviewRisk | null;
  maxTotalItems: number;
  anyTransfers: boolean;
  spansMultipleMonths: boolean;
};

export type UpcomingPreviewNextIssue = {
  risk_date: string | null;
  account_name?: string;
  reason?: string;
  projected_balance?: string | null;
  first_negative_transaction_id?: number | null;
} | null;

function isPreviewableTransaction(txn: DashboardUpcomingTransaction): boolean {
  return txn.kind !== "risk" && txn.amount != null;
}

function collapsedPairLegIds(displayId: string): [string, string] | null {
  const prefixes = ["xfer-", "ccpay-"] as const;
  for (const prefix of prefixes) {
    if (!displayId.startsWith(prefix)) continue;
    const rest = displayId.slice(prefix.length);
    const splitAt = rest.lastIndexOf("-");
    if (splitAt <= 0) return null;
    return [rest.slice(0, splitAt), rest.slice(splitAt + 1)];
  }
  return null;
}

/** Match preview rows to canonical ``first_negative_transaction_id`` (event id or DB id). */
function displayTxnMatchesMandatoryId(
  txn: DashboardUpcomingTransaction,
  mandatoryKey: string
): boolean {
  if (txn.id === mandatoryKey) return true;
  if (txn.transaction_id != null && String(txn.transaction_id) === mandatoryKey) {
    return true;
  }
  const legs = collapsedPairLegIds(txn.id);
  if (legs && (legs[0] === mandatoryKey || legs[1] === mandatoryKey)) return true;
  return txn.id.endsWith(`-${mandatoryKey}`);
}

/** Flatten preview transactions and mark the canonical first below-zero crossing.
 *
 * Prefer ``firstNegativeTransactionId`` from the backend risk event so the
 * highlighted row matches Home / Attention / Transactions ``balance_after``.
 * Fall back to the first scoped row with ``balance_after < 0`` only when no id.
 */
export function flattenUpcomingPreviewTransactions(
  transactions: DashboardUpcomingTransaction[],
  shortfallAccountName?: string | null,
  firstNegativeTransactionId?: string | number | null
): UpcomingPreviewTxnRow[] {
  const target = (shortfallAccountName ?? "").trim();
  const targetId =
    firstNegativeTransactionId != null && firstNegativeTransactionId !== ""
      ? String(firstNegativeTransactionId)
      : null;
  let crossed = false;
  const rows: UpcomingPreviewTxnRow[] = [];
  for (const txn of transactions) {
    if (!isPreviewableTransaction(txn)) continue;
    const bal = previewRowBalanceAfter(txn, target);
    const account = previewRowBalanceAccountName(txn, target);
    const scoped = !target || account === target;
    let isFirstZeroCross = false;
    if (targetId) {
      isFirstZeroCross = displayTxnMatchesMandatoryId(txn, targetId);
    } else if (scoped && !crossed && bal != null && bal < 0) {
      isFirstZeroCross = true;
      crossed = true;
    }
    rows.push({ txn, isFirstZeroCross });
  }
  return rows;
}

/** Balance-after for preview rows — source leg for collapsed bank transfers. */
export function previewRowBalanceAfter(
  txn: DashboardUpcomingTransaction,
  shortfallAccountName?: string | null
): number | null {
  const target = (shortfallAccountName ?? "").trim();
  const isTransfer = txn.is_transfer || txn.is_internal_transfer;
  if (isTransfer && !txn.is_credit_card_payment) {
    const fromBal = txn.transfer_from_balance_after ?? txn.balance_after;
    const toBal = txn.transfer_to_balance_after;
    if (target) {
      const from = (txn.transfer_from_account_name ?? txn.account_name ?? "").trim();
      const to = (txn.transfer_to_account_name ?? "").trim();
      if (from === target && fromBal != null) return parseAmount(fromBal);
      if (to === target && toBal != null) return parseAmount(toBal);
    }
    if (fromBal != null) return parseAmount(fromBal);
  }
  if (txn.balance_after == null) return null;
  return parseAmount(txn.balance_after);
}

function previewRowBalanceAccountName(
  txn: DashboardUpcomingTransaction,
  shortfallAccountName?: string | null
): string {
  const target = (shortfallAccountName ?? "").trim();
  const isTransfer = txn.is_transfer || txn.is_internal_transfer;
  if (isTransfer && !txn.is_credit_card_payment && target) {
    const from = (txn.transfer_from_account_name ?? txn.account_name ?? "").trim();
    const to = (txn.transfer_to_account_name ?? "").trim();
    if (from === target) return from;
    if (to === target) return to;
    return from || (txn.account_name ?? "").trim();
  }
  return (txn.account_name ?? "").trim();
}

/**
 * Same-day order must match Transactions Bal / canonical ledger walk:
 * ``(date, transaction_id, description)`` — not lexicographic event ``id``.
 */
function compareUpcomingPreviewTransactions(
  a: DashboardUpcomingTransaction,
  b: DashboardUpcomingTransaction
): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  const tidA = a.transaction_id != null ? Number(a.transaction_id) : Number.POSITIVE_INFINITY;
  const tidB = b.transaction_id != null ? Number(b.transaction_id) : Number.POSITIVE_INFINITY;
  if (tidA !== tidB) return tidA - tidB;
  const byDesc = (a.description || "").localeCompare(b.description || "");
  if (byDesc !== 0) return byDesc;
  return a.id.localeCompare(b.id);
}

/** Chronological display transactions across preview day groups. */
export function flattenUpcomingDisplayTransactions(
  groups: DashboardUpcomingGroup[]
): DashboardUpcomingTransaction[] {
  const flat: DashboardUpcomingTransaction[] = [];
  for (const group of groups) {
    flat.push(...upcomingDisplayTransactions(group));
  }
  flat.sort(compareUpcomingPreviewTransactions);
  return flat;
}

/**
 * Select up to maxItems preview rows, guaranteeing the canonical shortfall transaction
 * when it falls inside the preview horizon.
 */
export function selectUpcomingPreviewTransactions(
  groups: DashboardUpcomingGroup[],
  maxItems: number = UPCOMING_PREVIEW_MAX_ITEMS,
  mandatoryTxnId?: string | number | null
): { transactions: DashboardUpcomingTransaction[]; truncated: boolean } {
  const flat = flattenUpcomingDisplayTransactions(groups);
  if (flat.length <= maxItems) {
    return { transactions: flat, truncated: false };
  }

  const mandatoryKey =
    mandatoryTxnId != null && mandatoryTxnId !== "" ? String(mandatoryTxnId) : null;
  const mandatory = mandatoryKey
    ? flat.find((txn) => displayTxnMatchesMandatoryId(txn, mandatoryKey))
    : undefined;

  const head = flat.slice(0, maxItems);
  if (!mandatory || head.some((txn) => txn.id === mandatory.id)) {
    return { transactions: head, truncated: true };
  }

  const preview = [...flat.filter((txn) => txn.id !== mandatory.id).slice(0, maxItems - 1), mandatory];
  preview.sort(compareUpcomingPreviewTransactions);
  return { transactions: preview, truncated: true };
}

/** Rebuild day groups containing only the selected preview transactions. */
export function groupsForUpcomingPreviewTransactions(
  sourceGroups: DashboardUpcomingGroup[],
  selected: DashboardUpcomingTransaction[]
): DashboardUpcomingGroup[] {
  const selectedIds = new Set(selected.map((txn) => txn.id));
  const out: DashboardUpcomingGroup[] = [];
  for (const group of sourceGroups) {
    const display = upcomingDisplayTransactions(group);
    if (!display.some((txn) => selectedIds.has(txn.id))) continue;

    const keepRawIds = new Set<string>();
    for (const txn of display) {
      if (!selectedIds.has(txn.id)) continue;
      const legs = collapsedPairLegIds(txn.id);
      if (legs) {
        keepRawIds.add(legs[0]);
        keepRawIds.add(legs[1]);
      } else {
        keepRawIds.add(txn.id);
      }
    }
    out.push({
      ...group,
      transactions: group.transactions.filter((txn) => keepRawIds.has(txn.id)),
    });
  }
  return out;
}

export type UpcomingAmountTone = "positive" | "negative" | "neutral";

export function upcomingPreviewAmountTone(
  amount: number,
  txn: DashboardUpcomingTransaction
): UpcomingAmountTone {
  const isCardPayment = txn.is_credit_card_payment;
  const isTransfer = !isCardPayment && (txn.is_transfer || txn.is_internal_transfer);
  if (isTransfer) return "neutral";
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

export function upcomingPreviewBalanceTone(
  balance: number,
  isFirstZeroCross: boolean
): "critical" | "negative" | "neutral" {
  if (isFirstZeroCross) return "critical";
  if (balance < 0) return "negative";
  return "neutral";
}

/** Balance tone for a preview row (uses source leg for collapsed transfers). */
export function upcomingPreviewRowBalanceTone(
  txn: DashboardUpcomingTransaction,
  isFirstZeroCross: boolean,
  shortfallAccountName?: string | null
): "critical" | "negative" | "neutral" {
  const bal = previewRowBalanceAfter(txn, shortfallAccountName);
  if (bal == null) return "neutral";
  return upcomingPreviewBalanceTone(bal, isFirstZeroCross);
}

/** Projected end-of-day balance for a cash account on a grouped day. */
export function upcomingPreviewProjectedEndBalance(
  group: DashboardUpcomingGroup,
  accountName?: string | null
): string | null {
  if (!accountName) {
    return group.lowest_projected_balance ?? null;
  }
  if (group.lowest_projected_balance_account_name === accountName) {
    return group.lowest_projected_balance ?? null;
  }
  const row = group.lowest_projected_balances?.find((r) => r.account_name === accountName);
  return row?.balance ?? group.lowest_projected_balance ?? null;
}

/** One warning when an account first crosses below zero on this day. */
export function upcomingPreviewFirstNegativeWarning(
  group: DashboardUpcomingGroup,
  accountName: string | null | undefined,
  accountWasAlreadyNegative: boolean
): string | null {
  if (!accountName || accountWasAlreadyNegative) return null;
  if (group.lowest_projected_balance_account_name !== accountName) return null;
  if (!group.show_lowest_balance_marker) return null;
  const balance = parseAmount(group.lowest_projected_balance);
  if (balance >= 0) return null;
  return `${accountName} first falls below zero today`;
}

function previewSpansMultipleMonths(groups: DashboardUpcomingGroup[]): boolean {
  const keys = new Set(groups.map(upcomingMonthKey));
  return keys.size > 1;
}

function buildPreviewDayBlocks(
  groups: DashboardUpcomingGroup[],
  riskAccountName?: string | null
): UpcomingPreviewDayBlock[] {
  let accountWasNegative = false;
  return groups.map((group) => {
    const warning = upcomingPreviewFirstNegativeWarning(
      group,
      riskAccountName,
      accountWasNegative
    );
    const balance = parseAmount(
      upcomingPreviewProjectedEndBalance(group, riskAccountName)
    );
    if (balance < 0) {
      accountWasNegative = true;
    }
    return {
      group,
      transactions: upcomingDisplayTransactions(group),
      firstNegativeWarning: warning,
    };
  });
}

/** First below-zero from the forecast payload, not the first buffer-risk day. */
export function upcomingPreviewNextRiskDay(
  groups: DashboardUpcomingGroup[],
  nextIssue?: UpcomingPreviewNextIssue
): UpcomingPreviewRisk | null {
  if (nextIssue?.risk_date) {
    const match = groups.find((g) => g.date === nextIssue.risk_date);
    return {
      date: nextIssue.risk_date,
      accountName: nextIssue.account_name,
      reason: nextIssue.reason ?? "Projected balance drops below zero",
      projectedEndBalance:
        nextIssue.projected_balance ??
        (match
          ? upcomingPreviewProjectedEndBalance(match, nextIssue.account_name)
          : null),
    };
  }
  return null;
}

export function buildUpcomingDashboardPreview(
  groups: DashboardUpcomingGroup[],
  nextIssue?: UpcomingPreviewNextIssue,
  today: string = todayIsoLocal()
): UpcomingDashboardPreviewLayout {
  const dayFiltered = filterUpcomingGroupsForPreview(groups, UPCOMING_PREVIEW_DAYS, today);
  const dayWindowTruncated = dayFiltered.length < groups.length;
  const nextRisk = upcomingPreviewNextRiskDay(dayFiltered, nextIssue);
  const riskAccount = nextRisk?.accountName ?? nextIssue?.account_name ?? null;
  const mandatoryTxnId = nextIssue?.first_negative_transaction_id ?? null;
  const { transactions: selectedTxns, truncated: itemTruncated } = selectUpcomingPreviewTransactions(
    dayFiltered,
    UPCOMING_PREVIEW_MAX_ITEMS,
    mandatoryTxnId
  );
  const truncated = itemTruncated || dayWindowTruncated;
  const limitedGroups = groupsForUpcomingPreviewTransactions(dayFiltered, selectedTxns);
  const dayBlocks = buildPreviewDayBlocks(limitedGroups, riskAccount);
  const transactions = flattenUpcomingPreviewTransactions(
    selectedTxns,
    riskAccount,
    mandatoryTxnId
  );

  return {
    groups: limitedGroups,
    days: dayBlocks,
    transactions,
    daysHorizon: UPCOMING_PREVIEW_DAYS,
    truncated,
    truncatedMessage: truncated
      ? upcomingPreviewTruncatedMessage(UPCOMING_PREVIEW_MAX_ITEMS, UPCOMING_PREVIEW_DAYS, {
          itemTruncated,
          dayWindowTruncated,
        })
      : null,
    nextRisk,
    maxTotalItems: UPCOMING_PREVIEW_MAX_ITEMS,
    anyTransfers: limitedGroups.some(groupShowsTransferNote),
    spansMultipleMonths: previewSpansMultipleMonths(limitedGroups),
  };
}

function isPlaidOrImportedSource(source: string | null | undefined): boolean {
  const s = (source ?? "").toLowerCase();
  return s === "plaid" || s === "imported" || s.includes("plaid");
}

function isRuleSource(source: string | null | undefined): boolean {
  return (source ?? "").toLowerCase() === "rule";
}

export function upcomingKindLabel(
  txn: DashboardUpcomingTransaction
): string {
  if (txn.kind === "risk") return "Risk";
  if (txn.is_credit_card_payment) return "Credit card payment";
  if (txn.is_transfer || txn.is_internal_transfer) return "Transfer";
  if (txn.kind === "transfer") return "Transfer";
  if (txn.kind === "income") return "Income";
  if (txn.kind === "credit_card") return "Credit card payment";
  if (isPlaidOrImportedSource(txn.source)) return "Imported";
  if (isRuleSource(txn.source)) return "Rule";
  if (txn.kind === "bill") return "Expense";
  return "Bill";
}

/** Fixed-width pill text so description/amount columns align across rows. */
export function upcomingKindBadgeLabel(txn: DashboardUpcomingTransaction): string {
  if (txn.is_credit_card_payment || txn.kind === "credit_card") return "Card pay";
  return upcomingKindLabel(txn);
}

/** Full label when the pill uses a shortened badge label. */
export function upcomingKindBadgeTitle(txn: DashboardUpcomingTransaction): string | undefined {
  if (txn.is_credit_card_payment || txn.kind === "credit_card") {
    return "Credit card payment";
  }
  return undefined;
}

/** Tailwind width for the kind column in upcoming transaction rows. */
export const UPCOMING_KIND_BADGE_COLUMN = "3.5rem";

export function parseAmount(value: string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function transferRouteFromApi(txn: DashboardUpcomingTransaction): string | null {
  const from = txn.transfer_from_account_name?.trim();
  const to = txn.transfer_to_account_name?.trim();
  if (!from || !to) return null;
  return `From ${from} to ${to}`;
}

/** Primary account line for a collapsed bank transfer row. */
export function upcomingTransferAccountsLabel(
  txn: DashboardUpcomingTransaction
): string | null {
  const from = txn.transfer_from_account_name?.trim();
  const to = txn.transfer_to_account_name?.trim();
  if (from && to) return `${from} → ${to}`;
  return null;
}

/** Secondary balance line for dashboard preview rows. */
export function upcomingPreviewRowMetaLine(
  txn: DashboardUpcomingTransaction,
  opts?: { shortfallAccountName?: string | null; isFirstZeroCross?: boolean }
): string | null {
  const isTransfer = (txn.is_transfer || txn.is_internal_transfer) && !txn.is_credit_card_payment;
  const route = upcomingTransferAccountsLabel(txn);
  const shortfallAccount = (opts?.shortfallAccountName ?? "").trim();

  if (isTransfer && route) {
    const from = txn.transfer_from_account_name?.trim();
    const fromBal = txn.transfer_from_balance_after ?? txn.balance_after;
    if (from && fromBal != null) {
      return `${route} · ${from} after ${formatCurrency(fromBal)}`;
    }
    return route;
  }

  const account = (txn.account_name ?? "").trim();
  const bal = txn.balance_after;
  if (!account && bal == null) return null;

  const parts: string[] = [];
  if (account) parts.push(account);
  if (bal != null) {
    parts.push(`Balance after ${formatCurrency(bal)}`);
  }
  const line = parts.join(" · ");
  if (opts?.isFirstZeroCross && line) {
    return `${line} · First shortfall`;
  }
  return line || null;
}

function oppositeLegsMatch(
  a: DashboardUpcomingTransaction,
  b: DashboardUpcomingTransaction
): boolean {
  const amtA = parseAmount(a.amount);
  const amtB = parseAmount(b.amount);
  if (amtA === 0 || amtB === 0 || amtA * amtB >= 0) return false;
  if (Math.abs(amtA) !== Math.abs(amtB)) return false;
  return a.description === b.description;
}

function collapsePairKind(
  a: DashboardUpcomingTransaction,
  b: DashboardUpcomingTransaction
): "bank" | "credit_card" | null {
  if (!oppositeLegsMatch(a, b)) return null;
  if (a.is_credit_card_payment && b.is_credit_card_payment) return "credit_card";
  if (a.is_credit_card_payment || b.is_credit_card_payment) return null;
  const aXfer = a.is_transfer || a.is_internal_transfer;
  const bXfer = b.is_transfer || b.is_internal_transfer;
  return aXfer && bXfer ? "bank" : null;
}

function mergeCreditCardPaymentPairForDisplay(
  negative: DashboardUpcomingTransaction,
  positive: DashboardUpcomingTransaction
): DashboardUpcomingTransaction {
  const from =
    negative.transfer_from_account_name?.trim() ||
    negative.account_name?.trim() ||
    positive.transfer_from_account_name?.trim() ||
    "";
  const to =
    positive.transfer_to_account_name?.trim() ||
    positive.account_name?.trim() ||
    negative.transfer_to_account_name?.trim() ||
    "";
  const amt = -Math.abs(parseAmount(negative.amount));
  return {
    ...negative,
    id: `ccpay-${negative.id}-${positive.id}`,
    kind: "bill",
    is_credit_card_payment: true,
    is_transfer: true,
    is_internal_transfer: false,
    amount: amt.toFixed(2),
    account_name: from || negative.account_name,
    transfer_from_account_name: from || negative.transfer_from_account_name,
    transfer_to_account_name: to || positive.transfer_to_account_name,
    balance_after: negative.balance_after ?? positive.balance_after,
    risk_flag: negative.risk_flag || positive.risk_flag,
  };
}

function mergeTransferPairForDisplay(
  positive: DashboardUpcomingTransaction,
  negative: DashboardUpcomingTransaction
): DashboardUpcomingTransaction {
  const from =
    negative.transfer_from_account_name?.trim() ||
    negative.account_name?.trim() ||
    positive.transfer_from_account_name?.trim() ||
    "";
  const to =
    positive.transfer_to_account_name?.trim() ||
    positive.account_name?.trim() ||
    negative.transfer_to_account_name?.trim() ||
    "";
  const abs = Math.abs(parseAmount(positive.amount));
  return {
    ...negative,
    id: `xfer-${negative.id}-${positive.id}`,
    kind: "transfer",
    is_transfer: true,
    is_internal_transfer: true,
    is_credit_card_payment: false,
    amount: abs.toFixed(2),
    account_name: from || negative.account_name,
    transfer_from_account_name: from || negative.transfer_from_account_name,
    transfer_to_account_name: to || positive.transfer_to_account_name,
    balance_after: negative.balance_after ?? positive.balance_after,
    transfer_from_balance_after: negative.balance_after,
    transfer_to_balance_after: positive.balance_after,
    risk_flag: positive.risk_flag || negative.risk_flag,
  };
}

/** One row per bank transfer (destination inflow); matches backend collapse. */
export function collapseUpcomingTransferPairs(
  transactions: DashboardUpcomingTransaction[]
): DashboardUpcomingTransaction[] {
  if (transactions.length < 2) return transactions;
  const used = new Set<string>();
  const out: DashboardUpcomingTransaction[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    if (used.has(txn.id)) continue;
    let partner: DashboardUpcomingTransaction | undefined;
    let pairKind: "bank" | "credit_card" | null = null;
    for (let j = 0; j < transactions.length; j++) {
      if (i === j) continue;
      const other = transactions[j];
      if (used.has(other.id)) continue;
      const kind = collapsePairKind(txn, other);
      if (kind) {
        partner = other;
        pairKind = kind;
        break;
      }
    }
    if (partner && pairKind) {
      used.add(txn.id);
      used.add(partner.id);
      const neg = parseAmount(txn.amount) < 0 ? txn : partner;
      const pos = neg === txn ? partner : txn;
      if (pairKind === "credit_card") {
        out.push(mergeCreditCardPaymentPairForDisplay(neg, pos));
      } else {
        out.push(mergeTransferPairForDisplay(pos, neg));
      }
    } else {
      out.push(txn);
    }
  }
  return out;
}

/** Transactions for display (collapsed transfer pairs). */
export function upcomingDisplayTransactions(
  group: DashboardUpcomingGroup
): DashboardUpcomingTransaction[] {
  return collapseUpcomingTransferPairs(group.transactions);
}

export function upcomingDisplayTransactionCount(group: DashboardUpcomingGroup): number {
  const collapsed = upcomingDisplayTransactions(group);
  const raw = group.total_transaction_count ?? group.transactions.length;
  const removed = group.transactions.length - collapsed.length;
  return Math.max(collapsed.length, raw - removed);
}

/** Match the opposite leg of an internal transfer on the same day. */
function transferRouteFromPeers(
  txn: DashboardUpcomingTransaction,
  peers: DashboardUpcomingTransaction[]
): string | null {
  const amount = parseAmount(txn.amount);
  if (amount === 0) return null;
  const abs = Math.abs(amount);
  const counterpart = peers.find((other) => {
    if (other.id === txn.id) return false;
    const otherAmt = parseAmount(other.amount);
    if (Math.abs(otherAmt) !== abs || otherAmt * amount >= 0) return false;
    if (other.date !== txn.date) return false;
    const sameDesc = other.description === txn.description;
    const bothInternal =
      (txn.is_transfer || txn.is_internal_transfer || txn.is_credit_card_payment) &&
      (other.is_transfer || other.is_internal_transfer || other.is_credit_card_payment);
    return sameDesc && bothInternal;
  });
  if (!counterpart) return null;
  const from = amount < 0 ? txn.account_name : counterpart.account_name;
  const to = amount < 0 ? counterpart.account_name : txn.account_name;
  return `From ${from?.trim() || "Account"} to ${to?.trim() || "Account"}`;
}

/**
 * How money moves for this row — full route when known, otherwise single-account direction.
 */
export function upcomingAccountFlowLabel(
  txn: DashboardUpcomingTransaction,
  peers: DashboardUpcomingTransaction[] = []
): string {
  const route = transferRouteFromApi(txn) ?? transferRouteFromPeers(txn, peers);
  if (route) return route;

  const name = txn.account_name?.trim() || "Account";
  const amount = parseAmount(txn.amount);
  if (txn.is_transfer || txn.is_internal_transfer) {
    if (amount > 0) return `To ${name}`;
    if (amount < 0) return `From ${name}`;
    return name;
  }
  if (amount > 0) return `Into ${name}`;
  if (amount < 0) return `Out of ${name}`;
  return name;
}

export function upcomingKindBadgeClass(
  txn: DashboardUpcomingTransaction
): string {
  if (isPlaidOrImportedSource(txn.source)) {
    return "bg-slate-100 text-slate-700";
  }
  if (isRuleSource(txn.source)) {
    return "bg-indigo-100 text-indigo-800";
  }
  if (txn.is_credit_card_payment) return "bg-purple-100 text-purple-800";
  if (txn.is_transfer || txn.is_internal_transfer) {
    return "bg-blue-100 text-blue-800";
  }
  if (txn.kind === "income") return "bg-green-100 text-green-800";
  if (txn.kind === "risk" || txn.risk_flag) return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

/** Recompute net from displayed totals (income - expenses). */
export function dailyNetFromTotals(incomeTotal: string, expenseTotal: string): number {
  return parseAmount(incomeTotal) - parseAmount(expenseTotal);
}

export function formatNetDisplay(net: number): string {
  if (net > 0) return `+${net.toFixed(2)}`;
  return net.toFixed(2);
}

export function netColorClass(net: number): string {
  if (net > 0) return "text-green-700";
  if (net < 0) return "text-red-700";
  return "text-gray-600";
}

export function groupShowsTransferNote(group: DashboardUpcomingGroup): boolean {
  return group.transfers_excluded;
}

function upcomingGroupLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function upcomingDayOfWeek(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function upcomingMonthLabelUpper(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

function calendarTxnToUpcoming(
  txn: TimelineCalendarTransaction,
  date: string
): DashboardUpcomingTransaction {
  const kind = (txn.kind || "bill") as DashboardUpcomingTransaction["kind"];
  return {
    id: String(txn.id ?? `${date}-${txn.description}`),
    date: txn.date ?? date,
    account_id: txn.account_id ?? 0,
    account_name: txn.account_name,
    description: txn.description,
    amount: txn.amount,
    kind,
    category: txn.category,
    balance_after: txn.balance_after,
    is_transfer: Boolean(txn.is_transfer),
    is_internal_transfer: Boolean(txn.is_internal_transfer),
    is_credit_card_payment: Boolean(txn.is_credit_card_payment),
    transfer_from_account_name: txn.transfer_from_account_name,
    transfer_to_account_name: txn.transfer_to_account_name,
    transaction_id: txn.transaction_id ?? null,
    rule_id: txn.rule_id ?? null,
    source: txn.source,
    status: txn.status ?? null,
    risk_flag: Boolean(txn.risk_flag),
  };
}

function calendarDayToUpcomingGroup(
  day: TimelineCalendarDay,
  transactions: TimelineCalendarTransaction[]
): DashboardUpcomingGroup {
  const upcomingTxns = transactions.map((txn) => calendarTxnToUpcoming(txn, day.date));
  const transferTotal = parseAmount(day.transfer_total);
  const transfersExcluded =
    transferTotal > 0 ||
    upcomingTxns.some((t) => t.is_internal_transfer || t.is_transfer);
  return {
    date: day.date,
    label: upcomingGroupLabel(day.date),
    day_of_week: upcomingDayOfWeek(day.date),
    month_key: day.date.slice(0, 7),
    month_label: upcomingMonthLabelUpper(day.date),
    income_total: day.income_total,
    expense_total: day.expense_total,
    net_total: day.net_total,
    transfer_total: day.transfer_total,
    transfers_excluded: transfersExcluded,
    has_risk: day.has_risk,
    risk_reason: day.risk_reason,
    heat_level: day.heat_level,
    heat_label: day.heat_label,
    heat_reason: day.heat_reason,
    affected_account_name: day.affected_account_name,
    lowest_projected_balance: day.lowest_projected_balance,
    below_buffer_amount: day.below_buffer_amount,
    is_negative: day.is_negative,
    lowest_projected_balance_account_id: day.lowest_projected_balance_account_id,
    lowest_projected_balance_account_name: day.lowest_projected_balance_account_name,
    lowest_projected_balance_transaction_id: day.lowest_projected_balance_transaction_id,
    lowest_projected_balance_after_description: day.lowest_projected_balance_after_description,
    lowest_projected_balance_date: day.lowest_projected_balance_date,
    amount_needed_to_zero: day.amount_needed_to_zero,
    amount_needed_to_buffer: day.amount_needed_to_buffer,
    show_lowest_balance_marker: day.show_lowest_balance_marker,
    credit_balance_warnings: day.credit_balance_warnings,
    biggest_drivers: day.biggest_drivers,
    recovery_date: day.recovery_date,
    recovery_days_until: day.recovery_days_until,
    recovery_target: day.recovery_target,
    recovery_description: day.recovery_description,
    recovery_is_payroll: day.recovery_is_payroll,
    recovery_balance: day.recovery_balance,
    transactions: upcomingTxns,
    hidden_transaction_count: Math.max(0, upcomingTxns.length - UPCOMING_PER_DAY_VISIBLE),
    total_transaction_count: upcomingTxns.length,
    visible_transaction_limit: UPCOMING_PER_DAY_VISIBLE,
  };
}

export type UpcomingMoneyFlowFromCalendar = {
  groups: DashboardUpcomingGroup[];
  days: number;
  truncated: boolean;
};

/**
 * Build the Calendar page Upcoming Money Flow preview from calendar days
 * (14-day window, 25-transaction cap) without a dashboard summary request.
 */
export type UpcomingTransactionNavTarget = {
  type: "ledger";
  accountId: number;
  accountName?: string;
  focusDate: string;
  focusTransactionId?: number | null;
  focusRuleId?: number | null;
  focusEventId: string;
};

/** True when txn.id maps to a persisted transaction detail screen. */
export function isPersistedUpcomingTransactionId(id: string): boolean {
  return /^\d+$/.test(id);
}

/** Canonical persisted transaction id for ledger deep links (source leg for collapsed transfers). */
export function upcomingLedgerFocusTransactionId(
  txn: DashboardUpcomingTransaction
): number | null {
  if (txn.transaction_id != null && txn.transaction_id > 0) {
    return txn.transaction_id;
  }
  if (isPersistedUpcomingTransactionId(txn.id)) {
    return Number(txn.id);
  }
  const legs = collapsedPairLegIds(txn.id);
  if (legs) {
    const sourceLegId = legs[0];
    if (isPersistedUpcomingTransactionId(sourceLegId)) {
      return Number(sourceLegId);
    }
  }
  return null;
}

/** Navigation target for a dashboard upcoming preview row — opens the account ledger. */
export function upcomingTransactionNavTarget(
  txn: DashboardUpcomingTransaction
): UpcomingTransactionNavTarget {
  return {
    type: "ledger",
    accountId: txn.account_id,
    accountName: txn.account_name || undefined,
    focusDate: txn.date,
    focusTransactionId: upcomingLedgerFocusTransactionId(txn),
    focusRuleId: txn.rule_id ?? null,
    focusEventId: txn.id,
  };
}

export function buildUpcomingMoneyFlowFromCalendarDays(
  days: TimelineCalendarDay[],
  opts?: {
    today?: string;
    maxDays?: number;
    maxTransactions?: number;
  }
): UpcomingMoneyFlowFromCalendar {
  const today = opts?.today ?? todayIsoLocal();
  const maxDays = opts?.maxDays ?? UPCOMING_CALENDAR_WINDOW_DAYS;
  const maxTransactions = opts?.maxTransactions ?? UPCOMING_MAX_VISIBLE_TRANSACTIONS;
  const end = addDaysIso(today, maxDays);

  const windowDays = days.filter(
    (day) => day.date >= today && day.date <= end && (day.transactions?.length ?? 0) > 0
  );

  const flat: { day: TimelineCalendarDay; txn: TimelineCalendarTransaction }[] = [];
  for (const day of windowDays) {
    for (const txn of day.transactions) {
      flat.push({ day, txn });
    }
  }
  const truncated = flat.length > maxTransactions;
  const visible = flat.slice(0, maxTransactions);

  const byDate = new Map<string, { day: TimelineCalendarDay; txns: TimelineCalendarTransaction[] }>();
  for (const { day, txn } of visible) {
    const entry = byDate.get(day.date);
    if (entry) {
      entry.txns.push(txn);
    } else {
      byDate.set(day.date, { day, txns: [txn] });
    }
  }

  const groups = [...byDate.values()].map(({ day, txns }) =>
    calendarDayToUpcomingGroup(day, txns)
  );
  return { groups, days: maxDays, truncated };
}
