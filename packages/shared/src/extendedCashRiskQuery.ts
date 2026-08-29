/** Canonical React Query identity for the 6-month extended cash-risk scan. */

export const EXTENDED_CASH_RISK_QUERY_KEY = ["extended-cash-risk"] as const;

export const EXTENDED_CASH_RISK_STALE_MS = 60_000;

export const extendedCashRiskQueryDefaults = {
  queryKey: EXTENDED_CASH_RISK_QUERY_KEY,
  staleTime: EXTENDED_CASH_RISK_STALE_MS,
} as const;
