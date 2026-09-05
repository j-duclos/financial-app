import { useEffect, useId, useMemo, useState } from "react";
import {
  DTI_DEBT_TYPES,
  DTI_STUDENT_LOAN_PAYMENT_METHODS,
  DTI_STUDENT_LOAN_STATUSES,
  type DtiCreditCardSuggestion,
  type DtiDebtItem,
  type DtiDebtItemWritePayload,
  type DtiDebtType,
  type DtiPaymentSource,
  type DtiStudentLoanPaymentMethod,
  type DtiStudentLoanStatus,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  DEBT_TYPE_LABELS,
  STUDENT_LOAN_METHOD_LABELS,
  STUDENT_LOAN_STATUS_LABELS,
} from "../../lib/dtiDisplay";
import {
  alreadyLinkedAccountIds,
  normalizeDebtWritePayload,
  parseApiFieldErrors,
  previewFhaDeferredStudentLoanPayment,
} from "../../lib/dtiForm";
import DtiModalFrame, { DtiFieldShell, FieldError, describedByIds, fieldClass } from "./DtiModalFrame";

export type DtiDebtFormPrefill = {
  name: string;
  debt_type: DtiDebtType;
  monthly_payment: string;
  outstanding_balance: string;
  payment_source: DtiPaymentSource;
  linked_account_id: number | null;
  included: boolean;
  months_remaining: string;
  notes: string;
  student_loan_status: DtiStudentLoanStatus | "";
  student_loan_payment_method: DtiStudentLoanPaymentMethod;
};

type Props = {
  open: boolean;
  householdId: number;
  initial: DtiDebtItem | null;
  prefill: DtiDebtFormPrefill | null;
  debts: DtiDebtItem[];
  suggestions: DtiCreditCardSuggestion[];
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: DtiDebtItemWritePayload) => void;
};

function emptyPrefill(): DtiDebtFormPrefill {
  return {
    name: "",
    debt_type: "auto_loan",
    monthly_payment: "",
    outstanding_balance: "",
    payment_source: "manual",
    linked_account_id: null,
    included: true,
    months_remaining: "",
    notes: "",
    student_loan_status: "",
    student_loan_payment_method: "manual",
  };
}

export default function DtiDebtFormModal({
  open,
  householdId,
  initial,
  prefill,
  debts,
  suggestions,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const titleId = useId();
  const [form, setForm] = useState<DtiDebtFormPrefill>(emptyPrefill());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (prefill) {
      setForm({ ...emptyPrefill(), ...prefill });
    } else if (initial) {
      setForm({
        name: initial.name,
        debt_type: initial.debt_type,
        monthly_payment: initial.monthly_payment,
        outstanding_balance: initial.outstanding_balance ?? "",
        payment_source: initial.payment_source,
        linked_account_id: initial.linked_account_id,
        included: initial.included,
        months_remaining: initial.months_remaining != null ? String(initial.months_remaining) : "",
        notes: initial.notes ?? "",
        student_loan_status: initial.student_loan_status ?? "",
        student_loan_payment_method:
          initial.student_loan_payment_method === "fha_deferred_balance_percent"
            ? "fha_deferred_balance_percent"
            : "manual",
      });
    } else {
      setForm(emptyPrefill());
    }
    setErrors({});
  }, [open, initial, prefill]);

  const linkedIds = useMemo(
    () => alreadyLinkedAccountIds(debts, initial?.id),
    [debts, initial?.id]
  );

  const linkable = useMemo(() => {
    const rows: Array<{ id: number; label: string; minimum: string | null; usable: boolean }> = [];
    if (initial?.linked_account) {
      rows.push({
        id: initial.linked_account.id,
        label: initial.linked_account.effective_display_name || initial.linked_account.name,
        minimum: initial.linked_account.minimum_payment_amount,
        usable: Boolean(
          initial.linked_account.minimum_payment_amount &&
            initial.linked_account.minimum_payment_amount !== "0.00"
        ),
      });
    }
    for (const suggestion of suggestions) {
      if (linkedIds.has(suggestion.account_id)) continue;
      if (rows.some((row) => row.id === suggestion.account_id)) continue;
      rows.push({
        id: suggestion.account_id,
        label: suggestion.effective_display_name || suggestion.name,
        minimum: suggestion.minimum_payment_amount,
        usable: suggestion.minimum_payment_usable,
      });
    }
    return rows;
  }, [initial, suggestions, linkedIds]);

  const selectedLink = linkable.find((row) => row.id === form.linked_account_id) ?? null;
  const showLink = form.debt_type === "credit_card";
  const isStudentLoan = form.debt_type === "student_loan";
  const fhaEstimate = isStudentLoan && form.student_loan_payment_method === "fha_deferred_balance_percent";
  const linkedMinimum = form.payment_source === "linked_account_minimum";
  const needsManualPayment = !linkedMinimum && !fhaEstimate;
  const fhaPreview = fhaEstimate ? previewFhaDeferredStudentLoanPayment(form.outstanding_balance) : null;

  if (!open) return null;

  const api = error ? parseApiFieldErrors(error) : { form: "", fields: {} };
  const formError = error && !Object.keys(api.fields).length ? api.form : undefined;
  const nameError = errors.name || api.fields.name;
  const linkedError = errors.linked_account_id || api.fields.linked_account_id;
  const paymentSourceError = errors.payment_source || api.fields.payment_source;
  const monthlyError = errors.monthly_payment || api.fields.monthly_payment;
  const balanceError = errors.outstanding_balance || api.fields.outstanding_balance;
  const monthsError = errors.months_remaining || api.fields.months_remaining;
  const studentStatusError = errors.student_loan_status || api.fields.student_loan_status;
  const studentMethodError =
    errors.student_loan_payment_method || api.fields.student_loan_payment_method;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = normalizeDebtWritePayload(householdId, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.payload);
  }

  return (
    <DtiModalFrame
      title={initial ? "Edit debt obligation" : "Add debt obligation"}
      labelledBy={titleId}
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600">
          Add lender-counted monthly obligations such as auto loans, student loans, or credit-card
          minimums. Do not add ordinary utilities, groceries, or subscriptions.
        </p>
        <DtiFieldShell id="dti-debt-name" label="Name" errorId="dti-debt-name-error" error={nameError}>
          <input
            id="dti-debt-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={fieldClass}
            aria-invalid={Boolean(nameError)}
            aria-describedby={describedByIds(nameError, "dti-debt-name-error")}
          />
        </DtiFieldShell>
        <DtiFieldShell id="dti-debt-type" label="Debt type" errorId="dti-debt-type-error">
          <select
            id="dti-debt-type"
            value={form.debt_type}
            onChange={(e) => {
              const debt_type = e.target.value as DtiDebtType;
              setForm((f) => ({
                ...f,
                debt_type,
                ...(debt_type !== "credit_card"
                  ? { linked_account_id: null, payment_source: "manual" as const }
                  : {}),
                ...(debt_type !== "student_loan"
                  ? {
                      student_loan_status: "" as const,
                      student_loan_payment_method: "manual" as const,
                    }
                  : {}),
              }));
            }}
            className={fieldClass}
          >
            {DTI_DEBT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DEBT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </DtiFieldShell>
        {isStudentLoan ? (
          <>
            <DtiFieldShell
              id="dti-student-status"
              label="Loan status"
              errorId="dti-student-status-error"
              error={studentStatusError}
            >
              <select
                id="dti-student-status"
                value={form.student_loan_status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    student_loan_status: e.target.value as DtiStudentLoanStatus | "",
                  }))
                }
                className={fieldClass}
                aria-invalid={Boolean(studentStatusError)}
                aria-describedby={describedByIds(studentStatusError, "dti-student-status-error")}
              >
                <option value="">Select status…</option>
                {DTI_STUDENT_LOAN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STUDENT_LOAN_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </DtiFieldShell>
            <fieldset
              className="space-y-2"
              aria-invalid={Boolean(studentMethodError)}
              aria-describedby={studentMethodError ? "dti-student-method-error" : undefined}
            >
              <legend className="text-sm text-gray-700">
                How should the monthly DTI payment be calculated?
              </legend>
              {DTI_STUDENT_LOAN_PAYMENT_METHODS.map((method) => (
                <label key={method} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="dti-student-method"
                    className="mt-1"
                    checked={form.student_loan_payment_method === method}
                    onChange={() =>
                      setForm((f) => ({
                        ...f,
                        student_loan_payment_method: method,
                        payment_source: "manual",
                        linked_account_id: null,
                      }))
                    }
                  />
                  <span>{STUDENT_LOAN_METHOD_LABELS[method]}</span>
                </label>
              ))}
              <p className="text-xs text-gray-500">
                FHA planning estimate: 0.5% of the outstanding balance is used when the reported
                monthly student-loan payment is $0. Actual lender treatment may vary.
              </p>
              <FieldError id="dti-student-method-error" message={studentMethodError} />
            </fieldset>
          </>
        ) : null}
        {showLink ? (
          <DtiFieldShell
            id="dti-debt-linked"
            label="Linked credit-card account (optional)"
            errorId="dti-debt-linked-error"
            error={linkedError}
          >
            <select
              id="dti-debt-linked"
              value={form.linked_account_id ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const next = linkable.find((row) => row.id === id);
                setForm((f) => ({
                  ...f,
                  linked_account_id: id,
                  payment_source:
                    id != null && next?.usable ? "linked_account_minimum" : "manual",
                }));
              }}
              className={fieldClass}
              aria-invalid={Boolean(linkedError)}
              aria-describedby={describedByIds(linkedError, "dti-debt-linked-error")}
            >
              <option value="">No linked account</option>
              {linkable.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </DtiFieldShell>
        ) : null}
        {showLink && form.linked_account_id != null ? (
          <fieldset
            className="space-y-2"
            aria-invalid={Boolean(paymentSourceError)}
            aria-describedby={paymentSourceError ? "dti-debt-payment-source-error" : undefined}
          >
            <legend className="text-sm text-gray-700">Payment source</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="dti-payment-source"
                className="mt-1"
                checked={form.payment_source === "linked_account_minimum"}
                disabled={!selectedLink?.usable}
                onChange={() => setForm((f) => ({ ...f, payment_source: "linked_account_minimum" }))}
              />
              <span>
                Use linked account minimum
                {selectedLink?.minimum ? ` (${formatCurrency(selectedLink.minimum)})` : ""}
                <span className="block text-xs text-gray-500 mt-0.5">
                  This stays synchronized with the account minimum. It is not copied into a manual
                  payment field.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="dti-payment-source"
                className="mt-1"
                checked={form.payment_source === "manual"}
                onChange={() => setForm((f) => ({ ...f, payment_source: "manual" }))}
              />
              <span>Enter payment manually</span>
            </label>
            {!selectedLink?.usable ? (
              <p className="text-sm text-amber-800">
                This card has no usable minimum payment. Enter a monthly obligation manually.
              </p>
            ) : null}
            <FieldError id="dti-debt-payment-source-error" message={paymentSourceError} />
          </fieldset>
        ) : null}
        {needsManualPayment ? (
          <DtiFieldShell
            id="dti-debt-monthly"
            label="Monthly payment"
            errorId="dti-debt-monthly-error"
            error={monthlyError}
          >
            <input
              id="dti-debt-monthly"
              value={form.monthly_payment}
              onChange={(e) => setForm((f) => ({ ...f, monthly_payment: e.target.value }))}
              inputMode="decimal"
              className={fieldClass}
              aria-invalid={Boolean(monthlyError)}
              aria-describedby={describedByIds(monthlyError, "dti-debt-monthly-error")}
            />
          </DtiFieldShell>
        ) : linkedMinimum ? (
          <p className="text-sm text-gray-600">
            Effective monthly payment uses the linked account minimum and updates when that minimum
            changes.
          </p>
        ) : null}
        <DtiFieldShell
          id="dti-debt-balance"
          label={fhaEstimate ? "Outstanding balance" : "Outstanding balance (optional)"}
          errorId="dti-debt-balance-error"
          error={balanceError}
        >
          <input
            id="dti-debt-balance"
            value={form.outstanding_balance}
            onChange={(e) => setForm((f) => ({ ...f, outstanding_balance: e.target.value }))}
            inputMode="decimal"
            className={fieldClass}
            aria-invalid={Boolean(balanceError)}
            aria-describedby={describedByIds(balanceError, "dti-debt-balance-error")}
          />
        </DtiFieldShell>
        {fhaEstimate ? (
          <p className="text-sm text-gray-600" data-testid="dti-fha-preview">
            Estimate (0.5% of balance):{" "}
            {fhaPreview ? `${formatCurrency(fhaPreview)}/month` : "Enter a positive balance"}
            <span className="block text-xs text-gray-500 mt-0.5">
              Preview only. The saved DTI payment comes from the server after you save.
            </span>
          </p>
        ) : null}
        <DtiFieldShell
          id="dti-debt-months"
          label="Months remaining (optional)"
          errorId="dti-debt-months-error"
          error={monthsError}
        >
          <input
            id="dti-debt-months"
            value={form.months_remaining}
            onChange={(e) => setForm((f) => ({ ...f, months_remaining: e.target.value }))}
            inputMode="numeric"
            className={fieldClass}
            aria-invalid={Boolean(monthsError)}
            aria-describedby={describedByIds(monthsError, "dti-debt-months-error")}
          />
        </DtiFieldShell>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={form.included}
            onChange={(e) => setForm((f) => ({ ...f, included: e.target.checked }))}
          />
          <span>
            <span className="text-gray-800">Include in DTI calculation</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              When checked, the effective monthly payment is added to other monthly debt.
            </span>
          </span>
        </label>
        <div className="block text-sm">
          <label htmlFor="dti-debt-notes" className="text-gray-700">
            Notes (optional)
          </label>
          <textarea
            id="dti-debt-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className={fieldClass}
          />
        </div>
        {formError ? (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md min-h-[44px] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Add debt"}
          </button>
        </div>
      </form>
    </DtiModalFrame>
  );
}
