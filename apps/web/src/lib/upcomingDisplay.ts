import type {
  DashboardUpcomingGroup,
  DashboardUpcomingTransaction,
  DayHeatLevel,
} from "@budget-app/shared";
import { dayHeatEmoji, resolveDayHeatLevel } from "./dayHeatDisplay";
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

export type UpcomingPreviewDayBlock = {
  group: DashboardUpcomingGroup;
  transactions: DashboardUpcomingTransaction[];
  firstNegativeWarning: string | null;
};

export type UpcomingDashboardPreviewLayout = {
  groups: DashboardUpcomingGroup[];
  days: UpcomingPreviewDayBlock[];
  daysHorizon: number;
  truncated: boolean;
  truncatedMessage: string | null;
  nextRisk: UpcomingPreviewRisk | null;
  maxTotalItems: number;
  anyTransfers: boolean;
  spansMultipleMonths: boolean;
};

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

/** First at-risk day in preview window, or dashboard next_issue fallback. */
export function upcomingPreviewNextRiskDay(
  groups: DashboardUpcomingGroup[],
  nextIssue?: { risk_date: string | null; account_name?: string; reason?: string } | null
): UpcomingPreviewRisk | null {
  const riskAccount = nextIssue?.account_name ?? null;
  const risky = groups.find((g) => g.has_risk);
  if (risky) {
    return {
      date: risky.date,
      accountName: risky.affected_account_name ?? riskAccount,
      reason: risky.risk_reason ?? risky.heat_reason,
      projectedEndBalance: upcomingPreviewProjectedEndBalance(
        risky,
        risky.affected_account_name ?? riskAccount
      ),
    };
  }
  if (nextIssue?.risk_date) {
    const match = groups.find((g) => g.date === nextIssue.risk_date);
    return {
      date: nextIssue.risk_date,
      accountName: nextIssue.account_name,
      reason: nextIssue.reason,
      projectedEndBalance: match
        ? upcomingPreviewProjectedEndBalance(match, nextIssue.account_name)
        : null,
    };
  }
  return null;
}

export function buildUpcomingDashboardPreview(
  groups: DashboardUpcomingGroup[],
  nextIssue?: { risk_date: string | null; account_name?: string; reason?: string } | null,
  today: string = todayIsoLocal()
): UpcomingDashboardPreviewLayout {
  const dayFiltered = filterUpcomingGroupsForPreview(groups, UPCOMING_PREVIEW_DAYS, today);
  const dayWindowTruncated = dayFiltered.length < groups.length;
  const { groups: limitedGroups, truncated: itemTruncated } = limitUpcomingGroupsByItemCount(
    dayFiltered,
    UPCOMING_PREVIEW_MAX_ITEMS
  );
  const truncated = itemTruncated || dayWindowTruncated;
  const nextRisk = upcomingPreviewNextRiskDay(dayFiltered, nextIssue);
  const riskAccount = nextRisk?.accountName ?? nextIssue?.account_name ?? null;
  const dayBlocks = buildPreviewDayBlocks(limitedGroups, riskAccount);

  return {
    groups: limitedGroups,
    days: dayBlocks,
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
  if (from && to) return `From ${from} to ${to}`;
  return null;
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
    positive.transfer_from_account_name?.trim() ||
    negative.account_name?.trim() ||
    "";
  const to =
    positive.transfer_to_account_name?.trim() ||
    positive.account_name?.trim() ||
    "";
  const abs = Math.abs(parseAmount(positive.amount));
  return {
    ...positive,
    id: `xfer-${negative.id}-${positive.id}`,
    kind: "transfer",
    is_transfer: true,
    is_internal_transfer: true,
    is_credit_card_payment: false,
    amount: abs.toFixed(2),
    account_name: to || positive.account_name,
    transfer_from_account_name: from || positive.transfer_from_account_name,
    transfer_to_account_name: to || positive.transfer_to_account_name,
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
