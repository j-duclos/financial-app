import type {
  Account,
  GuidedDebtPayoffStrategy,
  RecurringRule,
  ScenarioGuidedStrategy,
  ScenarioGuidedStrategyWritePayload,
} from "@budget-app/shared";
import {
  eligibleGuidedDebtAccounts,
  eligibleGuidedSavingsAccounts,
  eligibleGuidedSourceAccounts,
  eligibleSavingsTransferRules,
} from "./guidedStrategyEligibility";

export const GUIDED_STRATEGY_TYPE = "debt_first_vs_save_first" as const;

export const GUIDED_PAYOFF_STRATEGY_OPTIONS: Array<{
  value: GuidedDebtPayoffStrategy;
  label: string;
  description: string;
}> = [
  {
    value: "avalanche",
    label: "Avalanche",
    description: "Highest APR first. The comparison uses the backend payoff order.",
  },
  {
    value: "snowball",
    label: "Snowball",
    description: "Smallest balance first. The comparison uses the backend payoff order.",
  },
  {
    value: "utilization_target",
    label: "Utilization target",
    description: "Focus on utilization. The comparison uses the backend payoff order.",
  },
  {
    value: "custom",
    label: "Custom order",
    description: "You choose the order. Payment sequencing still comes from the saved comparison.",
  },
];

export type GuidedStrategyWizardStep = 1 | 2 | 3 | 4;

export type GuidedStrategyFormState = {
  sourceAccountId: number | null;
  savingsAccountId: number | null;
  savingsTransferRuleIds: number[];
  includedDebtAccountIds: number[];
  payoffStrategy: GuidedDebtPayoffStrategy;
  customDebtOrderIds: number[];
  startDate: string;
  minimumCashBuffer: string;
  allocationPercent: string;
  resumeSavingsAfterPayoff: boolean;
  bufferTouched: boolean;
};

export type GuidedStrategyFieldErrors = Partial<
  Record<
    | "source_account_id"
    | "savings_account_id"
    | "savings_transfer_rule_ids"
    | "included_debt_account_ids"
    | "custom_debt_order_ids"
    | "payoff_strategy"
    | "start_date"
    | "minimum_cash_buffer"
    | "allocation_percent"
    | "resume_savings_after_payoff"
    | "non_field",
    string
  >
>;

export function localTodayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function positiveMoneyOrZero(raw: string | null | undefined): string {
  const n = parseFloat(String(raw ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  return n.toFixed(2);
}

export function emptyGuidedStrategyForm(now = new Date()): GuidedStrategyFormState {
  return {
    sourceAccountId: null,
    savingsAccountId: null,
    savingsTransferRuleIds: [],
    includedDebtAccountIds: [],
    payoffStrategy: "avalanche",
    customDebtOrderIds: [],
    startDate: localTodayIso(now),
    minimumCashBuffer: "0.00",
    allocationPercent: "100",
    resumeSavingsAfterPayoff: true,
    bufferTouched: false,
  };
}

export function formFromGuidedStrategy(
  strategy: ScenarioGuidedStrategy
): GuidedStrategyFormState {
  const selectedDebtIds = strategy.included_debt_accounts.map((account) => account.id);
  const customOrder = strategy.custom_debt_order.map((account) => account.id);
  return {
    sourceAccountId: strategy.source_account.id,
    savingsAccountId: strategy.savings_account.id,
    savingsTransferRuleIds: strategy.savings_transfer_rules.map((rule) => rule.id),
    includedDebtAccountIds: selectedDebtIds,
    payoffStrategy: strategy.payoff_strategy,
    customDebtOrderIds: syncCustomDebtOrder(selectedDebtIds, customOrder),
    startDate: strategy.start_date.slice(0, 10),
    minimumCashBuffer: strategy.minimum_cash_buffer,
    allocationPercent: String(parseFloat(strategy.allocation_percent)),
    resumeSavingsAfterPayoff: strategy.resume_savings_after_payoff,
    bufferTouched: true,
  };
}

/** Keep custom order as every selected debt exactly once, preserving relative order. */
export function syncCustomDebtOrder(
  selectedDebtIds: number[],
  currentOrder: number[]
): number[] {
  const selected = new Set(selectedDebtIds);
  const kept = currentOrder.filter((id, index) => selected.has(id) && currentOrder.indexOf(id) === index);
  const keptSet = new Set(kept);
  const appended = selectedDebtIds.filter((id) => !keptSet.has(id));
  return [...kept, ...appended];
}

export function moveCustomDebtOrderId(
  order: number[],
  id: number,
  direction: "up" | "down"
): number[] {
  const index = order.indexOf(id);
  if (index < 0) return order;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function applyUnambiguousGuidedDefaults(
  form: GuidedStrategyFormState,
  accounts: Account[],
  rules: RecurringRule[]
): GuidedStrategyFormState {
  let next = { ...form };
  const sources = eligibleGuidedSourceAccounts(accounts);
  if (next.sourceAccountId == null && sources.length === 1) {
    next = {
      ...next,
      sourceAccountId: sources[0].id,
      minimumCashBuffer: next.bufferTouched
        ? next.minimumCashBuffer
        : positiveMoneyOrZero(sources[0].minimum_buffer),
    };
  }

  const savings = eligibleGuidedSavingsAccounts(accounts, next.sourceAccountId);
  if (next.savingsAccountId == null && savings.length === 1) {
    next = { ...next, savingsAccountId: savings[0].id };
  }

  const matchingRules = eligibleSavingsTransferRules(
    rules,
    next.sourceAccountId,
    next.savingsAccountId
  );
  if (next.savingsTransferRuleIds.length === 0 && matchingRules.length === 1) {
    next = { ...next, savingsTransferRuleIds: [matchingRules[0].id] };
  }

  const debts = eligibleGuidedDebtAccounts(accounts);
  if (next.includedDebtAccountIds.length === 0 && debts.length === 1) {
    next = {
      ...next,
      includedDebtAccountIds: [debts[0].id],
      customDebtOrderIds: syncCustomDebtOrder([debts[0].id], next.customDebtOrderIds),
    };
  }

  return next;
}

export function validateGuidedStrategyForm(
  form: GuidedStrategyFormState,
  step?: GuidedStrategyWizardStep
): GuidedStrategyFieldErrors {
  const errors: GuidedStrategyFieldErrors = {};
  const include = (fieldStep: GuidedStrategyWizardStep) => step == null || step === fieldStep;

  if (include(1)) {
    if (form.sourceAccountId == null) {
      errors.source_account_id = "Choose the account the money currently comes from.";
    }
    if (form.savingsAccountId == null) {
      errors.savings_account_id = "Choose the savings destination currently receiving the transfers.";
    } else if (form.sourceAccountId != null && form.savingsAccountId === form.sourceAccountId) {
      errors.savings_account_id = "Source and savings accounts must be different.";
    }
  }

  if (include(2) && form.savingsTransferRuleIds.length === 0) {
    errors.savings_transfer_rule_ids = "Select at least one recurring savings transfer to test.";
  }

  if (include(3)) {
    if (form.includedDebtAccountIds.length === 0) {
      errors.included_debt_account_ids = "Select at least one credit card.";
    }
    if (form.payoffStrategy === "custom") {
      const selected = [...form.includedDebtAccountIds].sort((a, b) => a - b);
      const order = [...form.customDebtOrderIds].sort((a, b) => a - b);
      const unique = new Set(form.customDebtOrderIds);
      if (
        unique.size !== form.includedDebtAccountIds.length ||
        selected.join(",") !== order.join(",")
      ) {
        errors.custom_debt_order_ids =
          "Custom order must include every selected card exactly once.";
      }
    }
  }

  if (include(4)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) {
      errors.start_date = "Enter a start date.";
    }
    const buffer = parseFloat(form.minimumCashBuffer);
    if (!Number.isFinite(buffer) || buffer < 0) {
      errors.minimum_cash_buffer = "Minimum cash buffer must be zero or greater.";
    }
    const allocation = parseFloat(form.allocationPercent);
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      errors.allocation_percent = "Allocation must be greater than 0 and at most 100.";
    }
  }

  return errors;
}

export function buildGuidedStrategyPayload(
  form: GuidedStrategyFormState
): ScenarioGuidedStrategyWritePayload {
  if (form.sourceAccountId == null || form.savingsAccountId == null) {
    throw new Error("Source and savings accounts are required.");
  }
  const customDebtOrderIds =
    form.payoffStrategy === "custom"
      ? syncCustomDebtOrder(form.includedDebtAccountIds, form.customDebtOrderIds)
      : [];
  return {
    strategy_type: GUIDED_STRATEGY_TYPE,
    source_account_id: form.sourceAccountId,
    savings_account_id: form.savingsAccountId,
    included_debt_account_ids: [...form.includedDebtAccountIds],
    savings_transfer_rule_ids: [...form.savingsTransferRuleIds],
    start_date: form.startDate,
    minimum_cash_buffer: Number.parseFloat(form.minimumCashBuffer).toFixed(2),
    allocation_percent: Number.parseFloat(form.allocationPercent).toFixed(2),
    payoff_strategy: form.payoffStrategy,
    custom_debt_order_ids: customDebtOrderIds,
    resume_savings_after_payoff: form.resumeSavingsAfterPayoff,
  };
}

export function guidedStrategyReviewLines(args: {
  form: GuidedStrategyFormState;
  accounts: Account[];
  rules: RecurringRule[];
  accountName: (account: Account) => string;
}): string[] {
  const { form, accounts, rules, accountName } = args;
  const source = accounts.find((account) => account.id === form.sourceAccountId);
  const savings = accounts.find((account) => account.id === form.savingsAccountId);
  const selectedRules = rules.filter((rule) => form.savingsTransferRuleIds.includes(rule.id));
  const selectedDebts = accounts.filter((account) =>
    form.includedDebtAccountIds.includes(account.id)
  );
  const payoff = GUIDED_PAYOFF_STRATEGY_OPTIONS.find((opt) => opt.value === form.payoffStrategy);
  const lines: string[] = [];
  if (source && savings) {
    lines.push(
      `Selected future transfers from ${accountName(source)} into ${accountName(savings)} will be hypothetically redirected toward the selected credit cards.`
    );
  }
  if (selectedRules.length > 0) {
    lines.push(
      selectedRules.length === 1
        ? `Testing 1 savings transfer: ${selectedRules[0].name}.`
        : `Testing ${selectedRules.length} savings transfers.`
    );
  }
  if (selectedDebts.length > 0) {
    lines.push(
      `Paying ${selectedDebts.map(accountName).join(", ")} using ${payoff?.label ?? form.payoffStrategy}.`
    );
  }
  lines.push(`Start date ${form.startDate}. Allocation ${form.allocationPercent}%.`);
  lines.push(
    `Keep at least ${form.minimumCashBuffer} in the source account on each transfer date.`
  );
  lines.push(
    form.resumeSavingsAfterPayoff
      ? "Savings transfers resume after the selected cards are paid."
      : "Savings transfers stay paused after the selected cards are paid."
  );
  lines.push(
    "This is hypothetical. Saving does not change real transactions, recurring rules, forecasts, accounts, or balances."
  );
  return lines;
}

export function stepForGuidedField(
  field: keyof GuidedStrategyFieldErrors
): GuidedStrategyWizardStep {
  if (field === "source_account_id" || field === "savings_account_id") return 1;
  if (field === "savings_transfer_rule_ids") return 2;
  if (
    field === "included_debt_account_ids" ||
    field === "custom_debt_order_ids" ||
    field === "payoff_strategy"
  ) {
    return 3;
  }
  return 4;
}
