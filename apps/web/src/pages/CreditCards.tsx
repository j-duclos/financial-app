import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAccountPayoff, getDebtPayoffPlan, listAccounts } from "@budget-app/api-client";
import type {
  DebtPayoffMode,
  DebtPayoffStrategy,
  PayoffStrategy,
} from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { formatDateDisplay } from "../components/transactions/transactionsLedgerUtils";
import DebtPlannerCard from "../components/paymentPlanner/DebtPlannerCard";
import DebtStrategyDrawer from "../components/paymentPlanner/DebtStrategyDrawer";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_4 } from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import PlanningSubnav from "../components/PlanningSubnav";
import { whatIfDebtPath } from "../lib/whatIfContext";
import {
  DEBT_MODE_OPTIONS,
  DEBT_STRATEGY_OPTIONS,
  debtFreeHeadline,
  debtModeDescription,
  debtModeLabel,
  debtStrategyDescription,
  debtStrategyLabel,
  interestSavedLine,
  parseDebtModeParam,
} from "../lib/debtPayoffDisplay";
import {
  buildDrawerPayoffParams,
  drawerStrategyRequiresAmountInput,
  isCreditCardAccount,
} from "../lib/paymentPlannerDisplay";
import {
  paymentPlannerQueryKeys,
  type PlannerScenarioInputs,
} from "../lib/paymentPlannerQueryKeys";

/** Neutral baseline — matches backend plan default (extra_monthly → 0). */
const NEUTRAL_EXTRA_MONTHLY = "0";

export default function CreditCards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("account") ?? "";
  const amountFromUrl = searchParams.get("amount") ?? "";
  const strategyFromUrl = searchParams.get("strategy") as PayoffStrategy | null;

  const [strategy, setStrategy] = useState<DebtPayoffStrategy>("avalanche");
  const [mode, setMode] = useState<DebtPayoffMode>(
    () => parseDebtModeParam(searchParams.get("mode")) ?? "aggressive"
  );

  // Draft what-if inputs (do not drive the plan query until Apply).
  const [draftExtraMonthly, setDraftExtraMonthly] = useState(NEUTRAL_EXTRA_MONTHLY);
  const [draftLump, setDraftLump] = useState("");
  const [draftLumpAccount, setDraftLumpAccount] = useState("");
  // Applied scenario — only these change the debt-plan query key.
  const [appliedExtraMonthly, setAppliedExtraMonthly] = useState(NEUTRAL_EXTRA_MONTHLY);
  const [appliedLump, setAppliedLump] = useState("");
  const [appliedLumpAccount, setAppliedLumpAccount] = useState("");

  const [cardStrategy, setCardStrategy] = useState<PayoffStrategy>("minimum_payment");
  const [amountInput, setAmountInput] = useState(amountFromUrl);
  const [appliedAmountInput, setAppliedAmountInput] = useState(amountFromUrl);

  useEffect(() => {
    if (strategyFromUrl === "custom_amount" && amountFromUrl) {
      setCardStrategy("custom_amount");
      setAmountInput(amountFromUrl);
      setAppliedAmountInput(amountFromUrl);
      return;
    }
    if (strategyFromUrl === "statement_balance" || strategyFromUrl === "minimum_payment") {
      setCardStrategy(strategyFromUrl);
      setAmountInput("");
      setAppliedAmountInput("");
      return;
    }
    if (amountFromUrl) {
      setAmountInput(amountFromUrl);
      setAppliedAmountInput(amountFromUrl);
      if (Number(amountFromUrl) > 0) {
        setCardStrategy("custom_amount");
      }
      return;
    }
    setCardStrategy("minimum_payment");
    setAmountInput("");
    setAppliedAmountInput("");
  }, [selectedId, strategyFromUrl, amountFromUrl]);

  const accountsQuery = useQuery({
    queryKey: paymentPlannerQueryKeys.accounts,
    queryFn: () =>
      listAccounts({
        active_only: true,
        page_size: 500,
        balance: "true",
        account_type: "CREDIT",
      }),
  });
  const accounts = accountsQuery.data?.results ?? [];
  const creditCards = useMemo(() => accounts.filter(isCreditCardAccount), [accounts]);

  const scenarioInputs: PlannerScenarioInputs = useMemo(
    () => ({
      strategy,
      mode,
      extraMonthly: appliedExtraMonthly,
      lumpSum: appliedLump,
      lumpSumAccountId: appliedLumpAccount ? Number(appliedLumpAccount) : null,
    }),
    [strategy, mode, appliedExtraMonthly, appliedLump, appliedLumpAccount]
  );

  const planQuery = useQuery({
    queryKey: paymentPlannerQueryKeys.plan(scenarioInputs),
    queryFn: ({ signal }) =>
      getDebtPayoffPlan(
        {
          strategy: scenarioInputs.strategy,
          mode: scenarioInputs.mode,
          extra_monthly: scenarioInputs.extraMonthly || "0",
          lump_sum: scenarioInputs.lumpSum || undefined,
          lump_sum_account: scenarioInputs.lumpSumAccountId ?? undefined,
        },
        { signal }
      ),
    enabled: creditCards.length > 0,
    placeholderData: keepPreviousData,
  });
  const plan = planQuery.data;

  const selectedAccount = useMemo(
    () => creditCards.find((a) => String(a.id) === selectedId) ?? null,
    [creditCards, selectedId]
  );

  const selectedPlanCard = useMemo(
    () => plan?.cards.find((c) => String(c.account_id) === selectedId) ?? null,
    [plan, selectedId]
  );

  const projectionAmount =
    cardStrategy === "custom_amount" ? appliedAmountInput : amountInput;

  const projectionEnabled =
    !!selectedAccount &&
    !!selectedPlanCard &&
    (drawerStrategyRequiresAmountInput(cardStrategy)
      ? projectionAmount.trim() !== "" && Number(projectionAmount) > 0
      : true);

  const projectionQuery = useQuery({
    queryKey: paymentPlannerQueryKeys.accountPayoff(selectedId, cardStrategy, projectionAmount),
    queryFn: async ({ signal }) => {
      if (!selectedAccount || !selectedPlanCard) throw new Error("No account selected.");
      if (drawerStrategyRequiresAmountInput(cardStrategy)) {
        const val = projectionAmount.trim();
        if (!val || Number(val) <= 0) throw new Error("Enter a positive payment.");
      }
      return getAccountPayoff(
        selectedAccount.id,
        buildDrawerPayoffParams(
          selectedAccount,
          selectedPlanCard,
          cardStrategy,
          projectionAmount
        ),
        { signal }
      );
    },
    enabled: projectionEnabled,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const projectionError =
    projectionQuery.error instanceof Error ? projectionQuery.error.message : null;

  const whatIfDirty =
    draftExtraMonthly !== appliedExtraMonthly ||
    draftLump !== appliedLump ||
    draftLumpAccount !== appliedLumpAccount;

  const customAmountDirty = amountInput !== appliedAmountInput;

  function applyWhatIf() {
    setAppliedExtraMonthly(draftExtraMonthly);
    setAppliedLump(draftLump);
    setAppliedLumpAccount(draftLumpAccount);
  }

  function selectAccount(accountId: number) {
    const id = String(accountId);
    if (selectedId === id) {
      setSearchParams({});
      return;
    }
    setSearchParams({ account: id });
  }

  function closeDrawer() {
    setSearchParams({});
  }

  if (accountsQuery.isLoading) {
    return (
      <div className={PAGE_SHELL_PY}>
        <div className="mb-4 space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Payment Planner</h1>
          <p className="text-sm text-gray-600">How should I eliminate debt?</p>
          <PlanningSubnav />
        </div>
        <p className="text-sm text-gray-500 animate-pulse">Loading credit cards…</p>
      </div>
    );
  }

  if (accountsQuery.isError) {
    return (
      <div className={PAGE_SHELL_PY}>
        <div className="mb-4 space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Payment Planner</h1>
          <PlanningSubnav />
        </div>
        <p className="text-sm text-red-600">Could not load credit cards.</p>
      </div>
    );
  }

  if (accountsQuery.isSuccess && creditCards.length === 0) {
    return (
      <div className={PAGE_SHELL_PY}>
        <div className="mb-4 space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Payment Planner</h1>
          <p className="text-sm text-gray-600">How should I eliminate debt?</p>
          <PlanningSubnav />
        </div>
        <p className="text-gray-600 mb-3 text-sm">No credit cards yet.</p>
        <Link to="/accounts" className="text-blue-600 hover:underline">
          Add a credit card
        </Link>
      </div>
    );
  }

  const drawerProps =
    selectedAccount && selectedPlanCard
      ? {
          account: selectedAccount,
          planCard: selectedPlanCard,
          globalPlan: plan,
          cardStrategy,
          amountInput,
          onStrategyChange: setCardStrategy,
          onAmountChange: setAmountInput,
          onApplyCustomAmount: (amount: string) => {
            setAmountInput(amount);
            setAppliedAmountInput(amount);
          },
          customAmountDirty,
          projection: projectionQuery.data,
          projectionLoading: projectionQuery.isFetching,
          projectionError,
          onClose: closeDrawer,
        }
      : null;

  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Payment Planner</h1>
            <p className="text-sm text-gray-600 mt-1">How should I eliminate debt?</p>
          </div>
          <Link
            to={selectedId ? whatIfDebtPath(selectedId) : "/scenarios"}
            className="shrink-0 text-sm font-medium text-blue-700 hover:underline"
          >
            Try in What-If
          </Link>
        </div>
        <PlanningSubnav />
      </div>
      {plan && (
        <section className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-3 space-y-2">
          {planQuery.isFetching && !planQuery.isLoading ? (
            <p className="text-xs text-indigo-700 animate-pulse">Recalculating plan…</p>
          ) : null}
          <div className={METRIC_TILE_GRID_4}>
            <DashboardMetricTile label="Total debt" value={formatCurrency(plan.total_debt)} />
            <DashboardMetricTile label="Weighted APR" value={`${plan.weighted_apr}%`} />
            <DashboardMetricTile
              label="Interest burn / mo"
              value={formatCurrency(plan.monthly_interest_burn)}
              valueClassName="text-red-700"
            />
            <DashboardMetricTile
              label="Debt-free"
              value={
                plan.debt_free_date
                  ? formatDateDisplay(plan.debt_free_date)
                  : plan.debt_free_possible
                    ? "—"
                    : "Needs higher pay"
              }
            />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p className="text-sm font-semibold text-indigo-950">{debtFreeHeadline(plan)}</p>
            {interestSavedLine(plan) && (
              <p className="text-xs text-emerald-800 font-medium">{interestSavedLine(plan)}</p>
            )}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Strategy</h2>
          <div className="flex flex-wrap gap-1.5">
            {DEBT_STRATEGY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.description}
                onClick={() => setStrategy(o.id)}
                className={`px-2.5 py-1 rounded-full text-xs border ${
                  strategy === o.id
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <h2 className="text-sm font-semibold text-gray-900 pt-1">Payoff mode</h2>
          <div className="flex flex-wrap gap-1.5">
            {DEBT_MODE_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.description}
                onClick={() => setMode(o.id)}
                className={`px-2.5 py-1 rounded-full text-xs border ${
                  mode === o.id
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 hover:bg-gray-50"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="pt-2 mt-1 border-t border-gray-100 space-y-1.5">
            <p className="text-xs text-gray-600 leading-snug">
              <span className="font-medium text-gray-800">{debtStrategyLabel(strategy)}:</span>{" "}
              {debtStrategyDescription(strategy)}
            </p>
            <p className="text-xs text-gray-600 leading-snug">
              <span className="font-medium text-gray-800">{debtModeLabel(mode)}:</span>{" "}
              {debtModeDescription(mode)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">What-if simulator</h2>
          <label className="block text-xs">
            <span className="text-gray-600">Extra $/month toward debt</span>
            <input
              type="number"
              min="0"
              value={draftExtraMonthly}
              onChange={(e) => setDraftExtraMonthly(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-gray-600">One-time lump sum $</span>
            <input
              type="number"
              min="0"
              value={draftLump}
              onChange={(e) => setDraftLump(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          {draftLump && (
            <label className="block text-xs">
              <span className="text-gray-600">Apply lump sum to card</span>
              <select
                value={draftLumpAccount}
                onChange={(e) => setDraftLumpAccount(e.target.value)}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select card</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {getEffectiveDisplayName(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!whatIfDirty}
            onClick={applyWhatIf}
            className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-indigo-700"
          >
            Update plan
          </button>
        </div>

        {plan && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 min-w-0 md:col-span-2 xl:col-span-1">
            <h2 className="text-sm font-semibold text-blue-900">Recommendations</h2>
            {plan.recommendations.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-blue-950">
                {plan.recommendations.map((r) => (
                  <li key={r.id}>• {r.message}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-blue-800">No recommendations for this scenario.</p>
            )}
            {plan.milestones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-700 mb-1">Milestones</h3>
                <div className="flex flex-wrap gap-1.5">
                  {plan.milestones.map((m) => (
                    <span
                      key={m.id}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        m.achieved
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-white border-gray-200 text-gray-600"
                      }`}
                      title={m.description}
                    >
                      {m.achieved ? "✓ " : "○ "}
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {plan && (
        <div className="xl:flex xl:gap-4 xl:items-start">
          <section className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Your debts</h2>
              <p className="text-xs text-gray-500">Select a card to model payments</p>
            </div>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-2.5 ${
                selectedId ? "xl:grid-cols-2" : "xl:grid-cols-3"
              }`}
            >
              {plan.cards.map((card) => (
                <DebtPlannerCard
                  key={card.account_id}
                  card={card}
                  selected={selectedId === String(card.account_id)}
                  onSelect={() => selectAccount(card.account_id)}
                />
              ))}
            </div>
          </section>

          {drawerProps && (
            <div className="hidden xl:block w-80 shrink-0 sticky top-4">
              <DebtStrategyDrawer variant="panel" {...drawerProps} />
            </div>
          )}
        </div>
      )}

      {drawerProps && (
        <div className="xl:hidden">
          <DebtStrategyDrawer variant="sheet" {...drawerProps} />
        </div>
      )}
    </div>
  );
}
