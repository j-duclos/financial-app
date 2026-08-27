import type {
  ReconcilePreviewResponse,
  ReconcileTransactionRow,
  ReconciliationSessionSummary,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";

export type ReconcilePhase = "home" | "statement" | "review" | "done";

export function sessionStatusLabel(session: Pick<ReconciliationSessionSummary, "is_active" | "is_balanced">): string {
  if (!session.is_active) return "Undone";
  return session.is_balanced ? "Completed" : "Unbalanced";
}

export function formatReconcileMoney(amount: string | number | null | undefined, currency = "USD"): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(n, currency);
}

export function formatStatementDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDateDisplay(iso);
}

export function normalizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const neg = cleaned.startsWith("-");
  const parts = cleaned.replace(/-/g, "").split(".");
  const whole = parts[0] ?? "";
  const frac = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
  const body = frac != null ? `${whole}.${frac}` : whole;
  return neg ? `-${body}` : body;
}

export function hasBankBalanceInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const n = parseFloat(trimmed);
  return Number.isFinite(n);
}

export function partitionReconcileTransactions(
  transactions: ReconcileTransactionRow[],
  checkedIds: Set<number>
): { checked: ReconcileTransactionRow[]; unchecked: ReconcileTransactionRow[] } {
  const checked: ReconcileTransactionRow[] = [];
  const unchecked: ReconcileTransactionRow[] = [];
  for (const txn of transactions) {
    if (checkedIds.has(txn.id)) checked.push(txn);
    else unchecked.push(txn);
  }
  return { checked, unchecked };
}

export function checkedIdsKey(ids: Iterable<number>): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

export function differenceStatusCopy(preview: Pick<ReconcilePreviewResponse, "difference" | "can_complete"> | null): {
  title: string;
  message: string;
  ready: boolean;
} {
  if (!preview) {
    return {
      title: "Difference",
      message: "Enter a statement ending balance to see the difference.",
      ready: false,
    };
  }
  if (preview.can_complete) {
    return {
      title: "Ready to reconcile",
      message: "Difference is $0.00. You can finish reconciliation.",
      ready: true,
    };
  }
  return {
    title: "Difference",
    message: "Your statement and cleared transactions do not match yet.",
    ready: false,
  };
}

export function lastReconciledSummary(opts: {
  lastPeriodEnd: string | null | undefined;
  endingBalance: string | null | undefined;
  currency?: string;
}): { dateLabel: string; balanceLabel: string } | null {
  if (!opts.lastPeriodEnd && opts.endingBalance == null) return null;
  return {
    dateLabel: opts.lastPeriodEnd ? formatStatementDate(opts.lastPeriodEnd) : "Never",
    balanceLabel: formatReconcileMoney(opts.endingBalance, opts.currency ?? "USD"),
  };
}

/** Credit accounts: user enters positive amount owed (matches web). */
export function bankBalanceHint(accountType: string | undefined): string {
  if (accountType === "CREDIT") {
    return "Enter the statement ending balance as the amount owed (positive).";
  }
  return "Enter the ending balance from your bank statement.";
}
