/**
 * Display-only labels for transaction.source. Stored enum values are unchanged.
 */
export function transactionSourceDisplayLabel(input: {
  source?: string | null;
  plaid_transaction_id?: string | null;
}): string {
  const src = (input.source ?? "").trim().toUpperCase();
  if ((input.plaid_transaction_id ?? "").trim() || src === "PLAID") {
    return "Bank transaction";
  }
  if (src === "RULE") return "Recurring rule";
  if (src === "ONE_TIME") return "Manual";
  if (src === "INTEREST") return "Interest";
  if (src === "SYSTEM") return "System";
  if (src === "ACTUAL" || src === "MANUAL" || src === "") return "Manual";
  return humanizeSourceToken(src);
}

function humanizeSourceToken(src: string): string {
  const words = src
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || "Manual";
}
