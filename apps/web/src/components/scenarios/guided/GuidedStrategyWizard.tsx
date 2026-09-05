import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, listAccounts, listRules, saveScenarioGuidedStrategy } from "@budget-app/api-client";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, RecurringRule, ScenarioGuidedStrategy } from "@budget-app/shared";
import { cadenceLabel } from "../../../lib/recurringDisplay";
import { formatUtilizationLine } from "../../../lib/scenarioDebtPayment";
import { balanceOwed } from "../../../lib/paymentPlannerDisplay";
import {
  GUIDED_HYPOTHETICAL_DISCLAIMER,
  fieldErrorsFromApiMessage,
} from "../../../lib/guidedStrategyDisplay";
import {
  eligibleGuidedDebtAccounts,
  eligibleGuidedSavingsAccounts,
  eligibleGuidedSourceAccounts,
  eligibleSavingsTransferRules,
} from "../../../lib/guidedStrategyEligibility";
import {
  GUIDED_PAYOFF_STRATEGY_OPTIONS,
  applyUnambiguousGuidedDefaults,
  buildGuidedStrategyPayload,
  emptyGuidedStrategyForm,
  formFromGuidedStrategy,
  guidedStrategyReviewLines,
  moveCustomDebtOrderId,
  stepForGuidedField,
  syncCustomDebtOrder,
  validateGuidedStrategyForm,
  type GuidedStrategyFieldErrors,
  type GuidedStrategyFormState,
  type GuidedStrategyWizardStep,
} from "../../../lib/guidedStrategyForm";

type GuidedStrategyWizardProps = {
  scenarioId: number;
  householdId?: number;
  existing: ScenarioGuidedStrategy | null;
  onClose: () => void;
  onSaved: (strategy: ScenarioGuidedStrategy) => void;
};

const STEP_TITLES: Record<GuidedStrategyWizardStep, string> = {
  1: "Where the money comes from",
  2: "Which savings transfers to test",
  3: "Which cards to pay",
  4: "Cash safety and review",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

export default function GuidedStrategyWizard({
  scenarioId,
  householdId,
  existing,
  onClose,
  onSaved,
}: GuidedStrategyWizardProps) {
  const [step, setStep] = useState<GuidedStrategyWizardStep>(1);
  const [form, setForm] = useState<GuidedStrategyFormState>(() =>
    existing ? formFromGuidedStrategy(existing) : emptyGuidedStrategyForm()
  );
  const [clientErrors, setClientErrors] = useState<GuidedStrategyFieldErrors>({});
  const [backendErrors, setBackendErrors] = useState<GuidedStrategyFieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hydratedFromExisting] = useState(() => existing != null);

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ["what-if-guided-accounts", householdId ?? null],
    queryFn: () =>
      listAccounts({
        active_only: true,
        page_size: 500,
        household: householdId,
        balance: "true",
      }),
    enabled: householdId != null,
  });
  const accounts = useMemo(
    () => (accountsData?.results ?? []) as Account[],
    [accountsData]
  );

  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ["what-if-guided-rules", householdId ?? null],
    queryFn: () => listRules(),
  });
  const rules = useMemo(
    () => (rulesData?.results ?? []) as RecurringRule[],
    [rulesData]
  );
  const loadingEligible = accountsLoading || rulesLoading;
  const formWithDefaults =
    hydratedFromExisting || loadingEligible
      ? form
      : applyUnambiguousGuidedDefaults(form, accounts, rules);

  const errors = { ...backendErrors, ...clientErrors };
  const sources = useMemo(() => eligibleGuidedSourceAccounts(accounts), [accounts]);
  const savingsOptions = useMemo(
    () => eligibleGuidedSavingsAccounts(accounts, formWithDefaults.sourceAccountId),
    [accounts, formWithDefaults.sourceAccountId]
  );
  const matchingRules = useMemo(
    () =>
      eligibleSavingsTransferRules(
        rules,
        formWithDefaults.sourceAccountId,
        formWithDefaults.savingsAccountId
      ),
    [rules, formWithDefaults.sourceAccountId, formWithDefaults.savingsAccountId]
  );
  const debts = useMemo(() => eligibleGuidedDebtAccounts(accounts), [accounts]);

  function updateForm(patch: Partial<GuidedStrategyFormState>) {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.sourceAccountId !== undefined && patch.sourceAccountId !== current.sourceAccountId) {
        if (next.savingsAccountId === patch.sourceAccountId) next.savingsAccountId = null;
        next.savingsTransferRuleIds = [];
        if (!current.bufferTouched) {
          const source = accounts.find((account) => account.id === patch.sourceAccountId);
          next.minimumCashBuffer =
            source?.minimum_buffer && parseFloat(source.minimum_buffer) > 0
              ? parseFloat(source.minimum_buffer).toFixed(2)
              : "0.00";
        }
      }
      if (patch.savingsAccountId !== undefined && patch.savingsAccountId !== current.savingsAccountId) {
        next.savingsTransferRuleIds = [];
      }
      if (patch.includedDebtAccountIds) {
        next.customDebtOrderIds = syncCustomDebtOrder(
          patch.includedDebtAccountIds,
          next.customDebtOrderIds
        );
      }
      return next;
    });
    setClientErrors({});
    setBackendErrors({});
    setSaveError(null);
  }

  function goNext() {
    const stepErrors = validateGuidedStrategyForm(formWithDefaults, step);
    setClientErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setForm(formWithDefaults);
    setStep((current) => (current < 4 ? ((current + 1) as GuidedStrategyWizardStep) : current));
  }

  async function handleSave() {
    const allErrors = validateGuidedStrategyForm(formWithDefaults);
    setClientErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      const firstField = Object.keys(allErrors)[0] as keyof GuidedStrategyFieldErrors;
      setStep(stepForGuidedField(firstField));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveScenarioGuidedStrategy(
        scenarioId,
        buildGuidedStrategyPayload(formWithDefaults)
      );
      onSaved(saved);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not save this strategy.";
      setSaveError(message);
      const parsed = fieldErrorsFromApiMessage(message);
      const mapped: GuidedStrategyFieldErrors = {};
      for (const [key, value] of Object.entries(parsed)) {
        mapped[key as keyof GuidedStrategyFieldErrors] = value;
      }
      if (Object.keys(mapped).length > 0) {
        setBackendErrors(mapped);
        const firstField = Object.keys(mapped)[0] as keyof GuidedStrategyFieldErrors;
        setStep(stepForGuidedField(firstField));
      }
    } finally {
      setSaving(false);
    }
  }

  const reviewLines = guidedStrategyReviewLines({
    form: formWithDefaults,
    accounts,
    rules,
    accountName: getEffectiveDisplayName,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full p-4 max-h-[90vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-strategy-wizard-title"
      >
        <h3 id="guided-strategy-wizard-title" className="font-medium text-gray-900">
          {existing ? "Edit Debt first vs. save first" : "Compare Debt first vs. save first"}
        </h3>
        <p className="text-xs text-gray-500 mt-1 mb-3">{GUIDED_HYPOTHETICAL_DISCLAIMER}</p>

        <p className="text-xs font-medium text-gray-600 mb-3">
          Step {step} of 4: {STEP_TITLES[step]}
        </p>

        {saveError ? (
          <p className="mb-3 text-sm text-red-700" role="alert">
            {saveError}
          </p>
        ) : null}

        {step === 1 && (
          <AccountsStep
            loading={loadingEligible}
            sources={sources}
            savingsOptions={savingsOptions}
            form={formWithDefaults}
            errors={errors}
            onChange={updateForm}
          />
        )}
        {step === 2 && (
          <TransfersStep
            loading={loadingEligible}
            matchingRules={matchingRules}
            form={formWithDefaults}
            errors={errors}
            sourceChosen={formWithDefaults.sourceAccountId != null}
            savingsChosen={formWithDefaults.savingsAccountId != null}
            onChange={updateForm}
          />
        )}
        {step === 3 && (
          <DebtStep
            loading={loadingEligible}
            debts={debts}
            form={formWithDefaults}
            errors={errors}
            onChange={updateForm}
          />
        )}
        {step === 4 && (
          <SafetyReviewStep
            form={formWithDefaults}
            errors={errors}
            reviewLines={reviewLines}
            onChange={updateForm}
          />
        )}

        <div className="flex justify-between gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((current) => (current - 1) as GuidedStrategyWizardStep)}
                className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
              >
                Back
              </button>
            ) : null}
            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="px-3 py-1.5 bg-indigo-700 text-white text-sm font-medium rounded hover:bg-indigo-800"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-3 py-1.5 bg-indigo-700 text-white text-sm font-medium rounded hover:bg-indigo-800 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save and compare"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsStep({
  loading,
  sources,
  savingsOptions,
  form,
  errors,
  onChange,
}: {
  loading: boolean;
  sources: Account[];
  savingsOptions: Account[];
  form: GuidedStrategyFormState;
  errors: GuidedStrategyFieldErrors;
  onChange: (patch: Partial<GuidedStrategyFormState>) => void;
}) {
  if (loading) {
    return <p className="text-sm text-gray-600">Loading eligible accounts…</p>;
  }
  if (sources.length === 0) {
    return (
      <p className="text-sm text-gray-700">
        No eligible source account was found. This comparison needs an active checking, savings, or
        cash account that can fund transfers.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="guided-source-account" className="block text-sm text-gray-700 mb-1">
          Money currently comes from
        </label>
        <select
          id="guided-source-account"
          value={form.sourceAccountId ?? ""}
          onChange={(event) =>
            onChange({
              sourceAccountId: event.target.value === "" ? null : Number(event.target.value),
            })
          }
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          <option value="">Choose an account</option>
          {sources.map((account) => (
            <option key={account.id} value={account.id}>
              {getEffectiveDisplayName(account)}
            </option>
          ))}
        </select>
        <FieldError message={errors.source_account_id} />
      </div>

      {savingsOptions.length === 0 ? (
        <p className="text-sm text-gray-700">
          No eligible savings destination was found
          {form.sourceAccountId != null ? " besides the source account" : ""}. Choose a different
          source, or add another active savings or cash account.
        </p>
      ) : (
        <div>
          <label htmlFor="guided-savings-account" className="block text-sm text-gray-700 mb-1">
            Currently saved into
          </label>
          <select
            id="guided-savings-account"
            value={form.savingsAccountId ?? ""}
            onChange={(event) =>
              onChange({
                savingsAccountId: event.target.value === "" ? null : Number(event.target.value),
              })
            }
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Choose an account</option>
            {savingsOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {getEffectiveDisplayName(account)}
              </option>
            ))}
          </select>
          <FieldError message={errors.savings_account_id} />
        </div>
      )}
    </div>
  );
}

function TransfersStep({
  loading,
  matchingRules,
  form,
  errors,
  sourceChosen,
  savingsChosen,
  onChange,
}: {
  loading: boolean;
  matchingRules: RecurringRule[];
  form: GuidedStrategyFormState;
  errors: GuidedStrategyFieldErrors;
  sourceChosen: boolean;
  savingsChosen: boolean;
  onChange: (patch: Partial<GuidedStrategyFormState>) => void;
}) {
  if (loading) {
    return <p className="text-sm text-gray-600">Loading recurring transfers…</p>;
  }
  if (!sourceChosen || !savingsChosen) {
    return (
      <p className="text-sm text-gray-700">
        Choose a source account and savings destination first so matching transfer rules can be shown.
      </p>
    );
  }
  if (matchingRules.length === 0) {
    return (
      <p className="text-sm text-gray-700">
        No recurring transfer rules go from the selected source account to the selected savings
        account. Add a recurring savings transfer, or go back and choose different accounts.
      </p>
    );
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-800 mb-2">
        Recurring savings transfers to test
      </legend>
      <div className="space-y-2">
        {matchingRules.map((rule) => {
          const checked = form.savingsTransferRuleIds.includes(rule.id);
          return (
            <label
              key={rule.id}
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                checked ? "border-indigo-500 bg-indigo-50/60" : "border-gray-200"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = checked
                    ? form.savingsTransferRuleIds.filter((id) => id !== rule.id)
                    : [...form.savingsTransferRuleIds, rule.id];
                  onChange({ savingsTransferRuleIds: next });
                }}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{rule.name}</span>
                <span className="block text-xs text-gray-600">
                  {formatCurrency(rule.amount, rule.currency)} · {cadenceLabel(rule)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <FieldError message={errors.savings_transfer_rule_ids} />
    </fieldset>
  );
}

function DebtStep({
  loading,
  debts,
  form,
  errors,
  onChange,
}: {
  loading: boolean;
  debts: Account[];
  form: GuidedStrategyFormState;
  errors: GuidedStrategyFieldErrors;
  onChange: (patch: Partial<GuidedStrategyFormState>) => void;
}) {
  if (loading) {
    return <p className="text-sm text-gray-600">Loading credit-card accounts…</p>;
  }
  if (debts.length === 0) {
    return (
      <p className="text-sm text-gray-700">
        No eligible credit-card debt was found. This comparison needs at least one active credit card.
      </p>
    );
  }

  const orderedDebts = form.customDebtOrderIds
    .map((id) => debts.find((account) => account.id === id))
    .filter((account): account is Account => account != null);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-gray-800 mb-2">Credit cards to include</legend>
        <div className="space-y-2">
          {debts.map((account) => {
            const checked = form.includedDebtAccountIds.includes(account.id);
            const owed = balanceOwed(account);
            const apr = account.apr ? `${parseFloat(account.apr)}% APR` : null;
            const utilization = formatUtilizationLine(account);
            const minPay = account.minimum_payment_amount
              ? `Min ${formatCurrency(account.minimum_payment_amount, account.currency)}`
              : null;
            const details = [
              owed != null ? formatCurrency(owed, account.currency) : null,
              apr,
              utilization ? `${utilization} used` : null,
              minPay,
            ].filter(Boolean);
            return (
              <label
                key={account.id}
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                  checked ? "border-indigo-500 bg-indigo-50/60" : "border-gray-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? form.includedDebtAccountIds.filter((id) => id !== account.id)
                      : [...form.includedDebtAccountIds, account.id];
                    onChange({ includedDebtAccountIds: next });
                  }}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">
                    {getEffectiveDisplayName(account)}
                  </span>
                  {details.length > 0 ? (
                    <span className="block text-xs text-gray-600">{details.join(" · ")}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        <FieldError message={errors.included_debt_account_ids} />
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-gray-800 mb-2">Payoff order</legend>
        <div className="space-y-2">
          {GUIDED_PAYOFF_STRATEGY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                form.payoffStrategy === option.value
                  ? "border-indigo-500 bg-indigo-50/60"
                  : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="guided-payoff-strategy"
                value={option.value}
                checked={form.payoffStrategy === option.value}
                onChange={() => onChange({ payoffStrategy: option.value })}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                <span className="block text-xs text-gray-600">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {form.payoffStrategy === "custom" && orderedDebts.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2" id="guided-custom-order-label">
            Custom payoff order
          </p>
          <ol className="space-y-2" aria-labelledby="guided-custom-order-label">
            {orderedDebts.map((account, index) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-2"
              >
                <span className="text-sm text-gray-900">
                  {index + 1}. {getEffectiveDisplayName(account)}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() =>
                      onChange({
                        customDebtOrderIds: moveCustomDebtOrderId(
                          form.customDebtOrderIds,
                          account.id,
                          "up"
                        ),
                      })
                    }
                    aria-label={`Move ${getEffectiveDisplayName(account)} up`}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40"
                    disabled={index === orderedDebts.length - 1}
                    onClick={() =>
                      onChange({
                        customDebtOrderIds: moveCustomDebtOrderId(
                          form.customDebtOrderIds,
                          account.id,
                          "down"
                        ),
                      })
                    }
                    aria-label={`Move ${getEffectiveDisplayName(account)} down`}
                  >
                    Move down
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <FieldError message={errors.custom_debt_order_ids} />
        </div>
      ) : null}
    </div>
  );
}

function SafetyReviewStep({
  form,
  errors,
  reviewLines,
  onChange,
}: {
  form: GuidedStrategyFormState;
  errors: GuidedStrategyFieldErrors;
  reviewLines: string[];
  onChange: (patch: Partial<GuidedStrategyFormState>) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="guided-start-date" className="block text-sm text-gray-700 mb-1">
          Start date
        </label>
        <input
          id="guided-start-date"
          type="date"
          value={form.startDate}
          onChange={(event) => onChange({ startDate: event.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <FieldError message={errors.start_date} />
      </div>
      <div>
        <label htmlFor="guided-cash-buffer" className="block text-sm text-gray-700 mb-1">
          Minimum cash buffer
        </label>
        <input
          id="guided-cash-buffer"
          type="number"
          min="0"
          step="0.01"
          value={form.minimumCashBuffer}
          onChange={(event) =>
            onChange({ minimumCashBuffer: event.target.value, bufferTouched: true })
          }
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-xs text-gray-600">
          Limits how much can leave the source account on each transfer date.
        </p>
        <FieldError message={errors.minimum_cash_buffer} />
      </div>
      <div>
        <label htmlFor="guided-allocation" className="block text-sm text-gray-700 mb-1">
          Allocation percentage
        </label>
        <input
          id="guided-allocation"
          type="number"
          min="0.01"
          max="100"
          step="0.01"
          value={form.allocationPercent}
          onChange={(event) => onChange({ allocationPercent: event.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <FieldError message={errors.allocation_percent} />
      </div>
      <label className="flex gap-2 items-start text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.resumeSavingsAfterPayoff}
          onChange={(event) => onChange({ resumeSavingsAfterPayoff: event.target.checked })}
        />
        Resume savings transfers after the selected cards are paid
      </label>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-900 mb-1">Review</p>
        <ul className="space-y-1 text-sm text-gray-700">
          {reviewLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
