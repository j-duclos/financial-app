export type TransactionSourceBadge =
  | "Income"
  | "Expense"
  | "Transfer"
  | "Rule"
  | "Imported";

export type SourceBadgeInput = {
  source?: string | null;
  rule_id?: number | null;
  type?: string | null;
  direction?: string | null;
  category_name?: string | null;
  description?: string | null;
  transfer_group_id?: number | null;
  linked_transaction_id?: number | null;
  has_transfer_destination?: boolean;
};

const TRANSFER_CATEGORIES = new Set(["Transfer", "Bank Transfer", "Credit Card Payment"]);

export function isTransferLikeRow(input: SourceBadgeInput): boolean {
  const type = (input.type ?? "").toUpperCase();
  const category = input.category_name ?? "";
  const description = input.description ?? "";
  return (
    type === "TRANSFER" ||
    TRANSFER_CATEGORIES.has(category) ||
    description === "Transfer" ||
    input.transfer_group_id != null ||
    input.linked_transaction_id != null ||
    input.has_transfer_destination === true
  );
}

export function resolveTransactionSourceBadge(input: SourceBadgeInput): TransactionSourceBadge {
  const source = (input.source ?? "").toLowerCase();
  const type = (input.type ?? "").toUpperCase();
  const direction = (input.direction ?? "").toUpperCase();
  const category = input.category_name ?? "";
  const description = input.description ?? "";

  if (source === "plaid") return "Imported";
  if (source === "rule" || source === "interest" || input.rule_id != null) return "Rule";
  if (isTransferLikeRow({ type, category_name: category, description })) {
    return "Transfer";
  }
  if (type === "INCOME" || type === "INFLOW" || direction === "INFLOW" || direction === "INCOME") {
    return "Income";
  }
  return "Expense";
}

export const SOURCE_BADGE_STYLES: Record<TransactionSourceBadge, string> = {
  Income: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Expense: "bg-red-50 text-red-800 border-red-200",
  Transfer: "bg-blue-50 text-blue-800 border-blue-200",
  Rule: "bg-violet-50 text-violet-800 border-violet-200",
  Imported: "bg-slate-100 text-slate-700 border-slate-200",
};
