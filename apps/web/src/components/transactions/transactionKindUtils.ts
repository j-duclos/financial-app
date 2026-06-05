import { isTransferLikeRow, type SourceBadgeInput } from "./sourceBadgeUtils";

export type TransactionKind = "Expense" | "Income" | "Transfer" | "Card Payment";

export function resolveTransactionKind(input: SourceBadgeInput): TransactionKind {
  const category = input.category_name ?? "";
  if (category === "Credit Card Payment") return "Card Payment";

  if (isTransferLikeRow(input)) return "Transfer";

  const type = (input.type ?? "").toUpperCase();
  const direction = (input.direction ?? "").toUpperCase();
  if (type === "INCOME" || type === "INFLOW" || direction === "INFLOW" || direction === "INCOME") {
    return "Income";
  }

  return "Expense";
}
