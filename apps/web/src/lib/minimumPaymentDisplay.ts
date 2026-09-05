import { formatCurrency } from "@budget-app/shared";
import type {
  Account,
  MinimumPaymentFreshness,
  MinimumPaymentMode,
  MinimumPaymentSource,
} from "@budget-app/shared";

export function formatMinimumPaymentSourceLine(account: {
  effective_minimum_payment_amount?: string | null;
  minimum_payment_amount?: string | null;
  minimum_payment_source?: MinimumPaymentSource | string | null;
  minimum_payment_freshness?: MinimumPaymentFreshness | string | null;
}): string {
  const amount =
    account.effective_minimum_payment_amount ?? account.minimum_payment_amount ?? null;
  const source = account.minimum_payment_source;
  const freshness = account.minimum_payment_freshness;
  if (amount == null || source === "none" || freshness === "unavailable") {
    return "Minimum unavailable — enter manually";
  }
  const money = formatCurrency(amount);
  if (source === "manual" || freshness === "manual") {
    return `${money}/month — manually entered`;
  }
  if (freshness === "stale") {
    return `${money}/month — last institution value; refresh recommended`;
  }
  if (freshness === "reauthorization_required") {
    return `${money}/month — reconnect bank login to refresh`;
  }
  if (freshness === "unsupported") {
    return `${money}/month — institution does not provide this value`;
  }
  if (source === "plaid") {
    return `${money}/month — synced from institution`;
  }
  return `${money}/month`;
}

export function providerDiffersFromManual(account: Account): boolean {
  const provider = account.provider_minimum_payment_amount;
  const manual = account.manual_minimum_payment_amount;
  if (provider == null || manual == null) return false;
  return provider !== manual;
}

export type CreditMinimumPaymentFormValue = {
  minimum_payment_mode: MinimumPaymentMode;
  manual_minimum_payment_amount: string;
};

export function accountToMinimumPaymentForm(account: Account | null): CreditMinimumPaymentFormValue {
  return {
    minimum_payment_mode: account?.minimum_payment_mode === "automatic" ? "automatic" : "manual",
    manual_minimum_payment_amount:
      account?.manual_minimum_payment_amount != null
        ? String(account.manual_minimum_payment_amount)
        : account?.minimum_payment_amount != null
          ? String(account.minimum_payment_amount)
          : "",
  };
}

export function freshnessLabel(freshness: MinimumPaymentFreshness | null | undefined): string {
  switch (freshness) {
    case "fresh":
      return "Fresh provider value";
    case "stale":
      return "Provider value needs refresh";
    case "manual":
      return "Manual value";
    case "unavailable":
      return "Provider unavailable";
    case "unsupported":
      return "Provider unsupported";
    case "reauthorization_required":
      return "Reauthorization required";
    case "sync_failed":
      return "Sync failed";
    case "product_not_enabled":
      return "Institution product not enabled";
    default:
      return "Unknown";
  }
}

export function sourceLabel(source: MinimumPaymentSource | null | undefined): string {
  if (source === "plaid") return "Institution";
  if (source === "manual") return "Manual";
  return "None";
}
