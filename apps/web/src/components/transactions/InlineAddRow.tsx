import { useRef, useEffect } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import { formatDateDisplay } from "./transactionsLedgerUtils";
import {
  LEDGER_TABLE_GRID,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";

export type InlineAddForm = {
  date: string;
  payee: string;
  category_id: number | "";
  transfer_to_account_id: number | "";
  amount: string;
  direction: "INFLOW" | "OUTFLOW";
};

type CategoryOption = { id: number; label: string; name: string };

type Props = {
  form: InlineAddForm;
  onChange: (patch: Partial<InlineAddForm>) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  categories: CategoryOption[];
  transferToAccounts: Account[];
  isTransferCategory: boolean;
  transferCategoryName?: string;
  isPending: boolean;
  currency: string;
  inlinePayToCardAccountId: number | null;
  inlineCardTimelineLoading: boolean;
  inlineOwedAsOfPaymentDate: number | null;
  inlineBankTransferDestId: number | null;
  inlineBankDestTimelineLoading: boolean;
  inlineDestPickAccount: Account | null | undefined;
  inlineBankDestBalanceBefore: number | null;
  inlineBankDestBalanceAfter: number | null;
  cardCurrency?: string;
};

export default function InlineAddRow({
  form,
  onChange,
  onSubmit,
  onCancel,
  categories,
  transferToAccounts,
  isTransferCategory,
  transferCategoryName,
  isPending,
  currency,
  inlinePayToCardAccountId,
  inlineCardTimelineLoading,
  inlineOwedAsOfPaymentDate,
  inlineBankTransferDestId,
  inlineBankDestTimelineLoading,
  inlineDestPickAccount,
  inlineBankDestBalanceBefore,
  inlineBankDestBalanceAfter,
  cardCurrency,
}: Props) {
  const payeeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    payeeRef.current?.focus();
  }, []);

  const signedAmt = parseFloat(form.amount);
  const canSubmit =
    form.amount.trim() &&
    signedAmt !== 0 &&
    !Number.isNaN(signedAmt) &&
    (!isTransferCategory || Boolean(form.transfer_to_account_id));

  return (
    <section className="relative z-10 flex-none flex flex-col w-full border-b-4 border-blue-400 bg-white">
      <LedgerSectionHeader
        title="New transaction"
        expanded={false}
        onToggleExpanded={() => {}}
        tone="entry"
        showExpand={false}
      />
      <LedgerColumnHeader className="bg-blue-50/40" centered hideBalance hideKind hideType />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !isPending) onSubmit();
        }}
      >
        <div className={`${LEDGER_TABLE_GRID} px-4 py-2 bg-blue-50/30 border-b border-blue-100`}>
          <input
            type="date"
            value={form.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className="w-full min-w-[8.5rem] rounded border border-blue-200 bg-white px-1.5 py-1 text-xs text-gray-700 tabular-nums"
            required
          />
          <span aria-hidden />
          <input
            ref={payeeRef}
            type="text"
            value={form.payee}
            onChange={(e) => onChange({ payee: e.target.value })}
            placeholder="Description"
            className="w-full min-w-0 rounded border border-blue-200 bg-white px-1.5 py-1 text-xs text-gray-900 placeholder:text-gray-400"
          />
          <span aria-hidden />
          <div className="min-w-0 space-y-1">
            <select
              value={form.category_id}
              onChange={(e) =>
                onChange({
                  category_id: e.target.value ? Number(e.target.value) : "",
                  transfer_to_account_id: "",
                })
              }
              className="w-full rounded border border-blue-200 bg-white px-1.5 py-1 text-xs text-gray-700"
            >
              <option value="">Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {isTransferCategory && (
              <select
                value={form.transfer_to_account_id}
                onChange={(e) =>
                  onChange({ transfer_to_account_id: e.target.value ? Number(e.target.value) : "" })
                }
                className="w-full rounded border border-blue-200 bg-white px-1.5 py-1 text-xs text-gray-700"
                required
              >
                <option value="">
                  {transferCategoryName === "Credit Card Payment" ? "Payment to" : "Transfer to"}
                </option>
                {transferToAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <input
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            placeholder="0.00"
            title="Negative = expense, positive = income"
            className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-sm text-right tabular-nums placeholder:text-gray-400"
            required
          />
          <span aria-hidden />
          <div className="flex flex-nowrap items-center justify-end gap-1 min-w-0">
            <button
              type="submit"
              disabled={isPending || !canSubmit}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
            >
              {isPending ? "…" : "Add"}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </form>

      {(inlinePayToCardAccountId != null || inlineBankTransferDestId != null) && (
        <div className="px-4 py-2 flex flex-wrap gap-3 text-xs text-gray-600 border-b border-blue-100 bg-blue-50/20">
          {inlinePayToCardAccountId != null && (
            <span>
              Owed on card (as of {formatDateDisplay(form.date)}):{" "}
              {inlineCardTimelineLoading ? (
                "Loading…"
              ) : inlineOwedAsOfPaymentDate != null ? (
                <strong className="text-red-700 tabular-nums">
                  {formatCurrency(String(inlineOwedAsOfPaymentDate), cardCurrency ?? currency)}
                </strong>
              ) : (
                "—"
              )}
            </span>
          )}
          {inlineBankTransferDestId != null && (
            <span>
              {inlineDestPickAccount?.name ?? "Account"}:{" "}
              {inlineBankDestTimelineLoading ? (
                "Loading…"
              ) : (
                <>
                  {inlineBankDestBalanceBefore != null
                    ? formatCurrency(
                        String(inlineBankDestBalanceBefore),
                        inlineDestPickAccount?.currency ?? currency
                      )
                    : "—"}
                  {" → "}
                  {inlineBankDestBalanceAfter != null
                    ? formatCurrency(
                        String(inlineBankDestBalanceAfter),
                        inlineDestPickAccount?.currency ?? currency
                      )
                    : "—"}
                </>
              )}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
