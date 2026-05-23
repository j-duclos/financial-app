import { useRef } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import { formatDateDisplay } from "./transactionsLedgerUtils";

export type AddTransactionForm = {
  date: string;
  payee: string;
  category_id: number | "";
  transfer_to_account_id: number | "";
  amount: string;
  direction: "INFLOW" | "OUTFLOW";
};

type CategoryOption = { id: number; label: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  form: AddTransactionForm;
  onChange: (patch: Partial<AddTransactionForm>) => void;
  onSubmit: () => void;
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

export default function AddTransactionModal({
  open,
  onClose,
  form,
  onChange,
  onSubmit,
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

  if (!open) return null;

  const signedAmt = parseFloat(form.amount);
  const canSubmit =
    form.amount.trim() &&
    signedAmt !== 0 &&
    !Number.isNaN(signedAmt) &&
    (!isTransferCategory || Boolean(form.transfer_to_account_id));

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close add transaction"
        onClick={onClose}
      />
      <aside className="relative w-full max-w-md bg-white shadow-xl flex flex-col max-h-full">
        <header className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Transaction</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 text-sm">
            Close
          </button>
        </header>

        <form
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }}
        >
          <Field label="Date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => onChange({ date: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </Field>

          <Field label="Payee">
            <input
              ref={payeeRef}
              type="text"
              value={form.payee}
              onChange={(e) => onChange({ payee: e.target.value })}
              placeholder="Payee"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Category">
            <select
              value={form.category_id}
              onChange={(e) =>
                onChange({
                  category_id: e.target.value ? Number(e.target.value) : "",
                  transfer_to_account_id: "",
                })
              }
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {isTransferCategory && (
            <Field label={transferCategoryName === "Credit Card Payment" ? "Payment to" : "Transfer to"}>
              <select
                value={form.transfer_to_account_id}
                onChange={(e) =>
                  onChange({ transfer_to_account_id: e.target.value ? Number(e.target.value) : "" })
                }
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">
                  {transferCategoryName === "Credit Card Payment" ? "Select credit card" : "Select bank account"}
                </option>
                {transferToAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Amount">
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => onChange({ amount: e.target.value })}
              placeholder="- for debit, no sign for credit"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              title="Amount (negative = expense, positive = income)"
              required
            />
          </Field>

          {inlinePayToCardAccountId != null && (
            <ProjectionBox title={`Owed on card (as of ${formatDateDisplay(form.date)})`} loading={inlineCardTimelineLoading}>
              <p className="text-base font-semibold text-red-700 tabular-nums">
                {inlineOwedAsOfPaymentDate != null
                  ? formatCurrency(String(inlineOwedAsOfPaymentDate), cardCurrency ?? currency)
                  : "—"}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                Projected from your timeline (scheduled charges and payments on or before this date).
              </p>
            </ProjectionBox>
          )}

          {inlineBankTransferDestId != null && (
            <ProjectionBox
              title={`${inlineDestPickAccount?.name ?? "Account"}: before / after`}
              loading={inlineBankDestTimelineLoading}
            >
              <p className="text-sm font-medium tabular-nums">
                {inlineBankDestBalanceBefore != null
                  ? formatCurrency(String(inlineBankDestBalanceBefore), inlineDestPickAccount?.currency ?? currency)
                  : "—"}
              </p>
              <p className="text-base font-semibold text-emerald-800 tabular-nums">
                →{" "}
                {inlineBankDestBalanceAfter != null
                  ? formatCurrency(String(inlineBankDestBalanceAfter), inlineDestPickAccount?.currency ?? currency)
                  : "—"}
              </p>
            </ProjectionBox>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex-1 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !canSubmit}
              className="flex-1 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ProjectionBox({
  title,
  loading,
  children,
}: {
  title: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium text-gray-700">{title}</div>
      {loading ? <p className="text-xs text-gray-500 mt-1">Loading…</p> : children}
    </div>
  );
}
