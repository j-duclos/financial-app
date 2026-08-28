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
    focus?: LedgerFocusKind;
    focusDate?: string;
    focusTransactionId?: string;
    focusRuleId?: string;
    focusEventId?: string;
  };
};

export function transactionsForAccountPath(
  accountId: number,
  accountName?: string
): TransactionsTabPath {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: {
      account: String(accountId),
      ...(accountName ? { accountName } : {}),
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
}): TransactionsTabPath {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: {
      account: String(input.accountId),
      ...(input.accountName ? { accountName: input.accountName } : {}),
      focus: input.focus ?? "ledger-event",
      ...(input.focusDate ? { focusDate: input.focusDate } : {}),
      ...(input.focusTransactionId != null
        ? { focusTransactionId: String(input.focusTransactionId) }
        : {}),
      ...(input.focusRuleId != null ? { focusRuleId: String(input.focusRuleId) } : {}),
      ...(input.focusEventId ? { focusEventId: input.focusEventId } : {}),
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
