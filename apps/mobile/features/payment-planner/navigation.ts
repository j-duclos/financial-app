/** Deep links from Payment Planner to related screens. */
export function accountDetailPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

export type LedgerFocusKind = "forecast-risk" | "ledger-event";

export type TransactionsTabPath = {
  pathname: "/(app)/(tabs)/transactions";
  params: {
    account: string;
    accountName?: string;
    /**
     * Always set on deep links so Expo Router does not keep a stale prior focus.
     * Use "__none__" (not "") when clearing — empty strings are often dropped on merge.
     */
    focus?: LedgerFocusKind | string;
    focusDate?: string;
    focusTransactionId?: string;
    focusRuleId?: string;
    focusEventId?: string;
    focusDescription?: string;
  };
};

/** Non-empty sentinel so Expo/React Navigation cannot strip the key and keep a stale prior focus. */
const FOCUS_CLEAR = "__none__";

export function transactionsForAccountPath(
  accountId: number,
  accountName?: string
): TransactionsTabPath {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: {
      account: String(accountId),
      ...(accountName ? { accountName } : {}),
      focus: FOCUS_CLEAR,
      focusDate: FOCUS_CLEAR,
      focusTransactionId: FOCUS_CLEAR,
      focusRuleId: FOCUS_CLEAR,
      focusEventId: FOCUS_CLEAR,
      focusDescription: FOCUS_CLEAR,
    },
  };
}

/** Deep link into an account ledger row (Money Flow, Attention, shortfall cards). */
export function transactionsForLedgerFocusPath(input: {
  accountId: number;
  accountName?: string;
  focus?: LedgerFocusKind;
  focusDate?: string | null;
  focusTransactionId?: number | null;
  focusRuleId?: number | null;
  focusEventId?: string | null;
  focusDescription?: string | null;
}): TransactionsTabPath {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: {
      account: String(input.accountId),
      ...(input.accountName ? { accountName: input.accountName } : {}),
      focus: input.focus ?? "ledger-event",
      focusDate: input.focusDate ?? FOCUS_CLEAR,
      focusTransactionId:
        input.focusTransactionId != null
          ? String(input.focusTransactionId)
          : FOCUS_CLEAR,
      focusRuleId:
        input.focusRuleId != null ? String(input.focusRuleId) : FOCUS_CLEAR,
      focusEventId: input.focusEventId ?? FOCUS_CLEAR,
      focusDescription: input.focusDescription?.trim()
        ? input.focusDescription.trim()
        : FOCUS_CLEAR,
    },
  };
}

/** Cash-risk deep link — scrolls the ledger to the forecast shortfall row. */
export function transactionsForForecastRiskPath(input: {
  accountId: number;
  accountName?: string;
  focusDate?: string | null;
  focusTransactionId?: number | null;
}): TransactionsTabPath {
  return transactionsForLedgerFocusPath({
    ...input,
    focus: "forecast-risk",
  });
}

export function planDetailsPath(): "/payment-planner/plan-details" {
  return "/payment-planner/plan-details";
}
