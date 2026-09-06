import type { PlaidHouseholdLiabilitySyncResult, PlaidLiabilitySyncResult } from "@budget-app/shared";

const SUCCESS_STATUSES = new Set(["success", "no_eligible_accounts"]);

export type LiabilityFeedbackTone = "success" | "partial" | "failure";

export type LiabilityFeedback = {
  tone: LiabilityFeedbackTone;
  message: string;
  needsUpdateConsent: boolean;
};

export function itemLiabilityFeedback(result: PlaidLiabilitySyncResult): LiabilityFeedback {
  const status = String(result.status || "");
  const updated = result.accounts_updated ?? 0;
  const missing = result.accounts_missing_liability ?? 0;
  if (status === "reauthorization_required") {
    return {
      tone: "failure",
      message:
        result.message ||
        "Additional bank consent is required before credit-card minimums can update.",
      needsUpdateConsent: true,
    };
  }
  if (status === "unsupported") {
    return {
      tone: "failure",
      message:
        result.message ||
        "This institution does not provide credit-card minimum payments. Enter a manual minimum.",
      needsUpdateConsent: false,
    };
  }
  if (status === "product_not_enabled" || status === "disabled") {
    return {
      tone: "failure",
      message:
        result.message ||
        "Plaid Liabilities is not enabled for this environment. Manual minimums still work.",
      needsUpdateConsent: false,
    };
  }
  if (status === "failed") {
    return {
      tone: "failure",
      message: result.message || "Could not refresh credit-card minimums from the institution.",
      needsUpdateConsent: false,
    };
  }
  if (status === "no_eligible_accounts") {
    return {
      tone: "success",
      message: result.message || "No eligible credit-card accounts on this connection.",
      needsUpdateConsent: false,
    };
  }
  if (SUCCESS_STATUSES.has(status) && missing > 0 && updated > 0) {
    return {
      tone: "partial",
      message: `Updated ${updated} card minimum${updated === 1 ? "" : "s"}. ${missing} card${missing === 1 ? "" : "s"} had no institution liability.`,
      needsUpdateConsent: false,
    };
  }
  if (SUCCESS_STATUSES.has(status) && missing > 0) {
    return {
      tone: "partial",
      message:
        result.message ||
        "The institution did not return a liability for one or more cards. Previous valid minimums were kept.",
      needsUpdateConsent: false,
    };
  }
  if (SUCCESS_STATUSES.has(status)) {
    return {
      tone: "success",
      message:
        updated > 0
          ? `Updated ${updated} card minimum${updated === 1 ? "" : "s"}.`
          : "Card minimums were already up to date.",
      needsUpdateConsent: false,
    };
  }
  return {
    tone: "failure",
    message: result.message || "Could not refresh credit-card minimums.",
    needsUpdateConsent: false,
  };
}

export function householdLiabilityFeedback(
  result: PlaidHouseholdLiabilitySyncResult
): LiabilityFeedback {
  const items = result.items ?? [];
  const updated = result.accounts_updated ?? items.reduce((n, row) => n + (row.accounts_updated ?? 0), 0);
  const reauth = result.reauthorization_required_count ?? items.filter((row) => row.status === "reauthorization_required").length;
  const failed = result.failed_count ?? items.filter((row) => ["failed", "disabled", "product_not_enabled"].includes(String(row.status))).length;
  const success = result.success_count ?? items.filter((row) => SUCCESS_STATUSES.has(String(row.status))).length;
  if (items.length === 0) {
    return {
      tone: "success",
      message: "No connected banks to refresh.",
      needsUpdateConsent: false,
    };
  }
  if (reauth > 0 && success === 0 && failed === 0) {
    return {
      tone: "failure",
      message: "Additional bank consent is required before credit-card minimums can update.",
      needsUpdateConsent: true,
    };
  }
  if (failed > 0 && success === 0 && reauth === 0) {
    return {
      tone: "failure",
      message: "Could not refresh credit-card minimums from the institution.",
      needsUpdateConsent: false,
    };
  }
  if (reauth > 0 || failed > 0 || items.some((row) => (row.accounts_missing_liability ?? 0) > 0)) {
    return {
      tone: "partial",
      message: `Updated ${updated} card minimum${updated === 1 ? "" : "s"}. Some connections need attention.`,
      needsUpdateConsent: reauth > 0,
    };
  }
  return {
    tone: "success",
    message:
      updated > 0
        ? `Updated ${updated} card minimum${updated === 1 ? "" : "s"}.`
        : "Card minimums were already up to date.",
    needsUpdateConsent: false,
  };
}
