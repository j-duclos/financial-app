import { formatCurrency } from "@budget-app/shared";
import type {
  DtiCalculationWarning,
  DtiDebtItem,
  DtiDebtType,
  DtiIncomeType,
  DtiPayoffImpact,
  DtiPaymentSource,
} from "@budget-app/shared";
import { parseMoneyToCents, parsePercentToHundredths, centsToMoney } from "./dtiForm";

export const DTI_PLANNING_DISCLAIMER =
  "Planning estimate only. Lender calculations and qualifying rules vary.";

export const INCOME_TYPE_LABELS: Record<DtiIncomeType, string> = {
  employment: "Employment",
  self_employment: "Self-employment",
  contract: "Contract",
  rental: "Rental",
  retirement: "Retirement",
  social_security: "Social Security",
  disability: "Disability",
  alimony: "Alimony",
  child_support: "Child support",
  other: "Other",
};

export const DEBT_TYPE_LABELS: Record<DtiDebtType, string> = {
  credit_card: "Credit card",
  auto_loan: "Auto loan",
  student_loan: "Student loan",
  mortgage: "Mortgage",
  home_equity: "Home equity",
  personal_loan: "Personal loan",
  installment_loan: "Installment loan",
  alimony: "Alimony",
  child_support: "Child support",
  other: "Other",
};

export function formatDtiPercent(value: string | null | undefined): string {
  if (value == null || value === "") return "Not available";
  return `${value}%`;
}

export type PercentPointChange = {
  label: string;
  subtitle: string | null;
};

/** Signed percentage-point change using integer hundredths. Not binary float subtraction. */
export function formatPercentPointChange(
  fromPercent: string | null | undefined,
  toPercent: string | null | undefined
): PercentPointChange {
  if (fromPercent == null || fromPercent === "" || toPercent == null || toPercent === "") {
    return { label: "Not available", subtitle: null };
  }
  const from = parsePercentToHundredths(fromPercent);
  const to = parsePercentToHundredths(toPercent);
  if (from == null || to == null) {
    return { label: "Not available", subtitle: null };
  }
  const subtitle = `${fromPercent}% → ${toPercent}%`;
  const delta = to - from;
  if (delta === 0) return { label: "No change", subtitle };
  const magnitude = centsToMoney(Math.abs(delta));
  const sign = delta > 0 ? "+" : "\u2212";
  return { label: `${sign}${magnitude} percentage points`, subtitle };
}

export function formatDtiMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "Not available";
  return formatCurrency(value);
}

export function paymentSourceLabel(source: DtiPaymentSource): string {
  return source === "linked_account_minimum" ? "Synced from account minimum" : "Manual payment";
}

export function debtRowView(row: DtiDebtItem) {
  return {
    typeLabel: DEBT_TYPE_LABELS[row.debt_type],
    balanceLabel: row.outstanding_balance ? formatCurrency(row.outstanding_balance) : null,
    effectivePaymentLabel: formatCurrency(row.effective_monthly_payment),
    paymentSource: paymentSourceLabel(row.payment_source),
    linkedAccountLabel: row.linked_account
      ? row.linked_account.effective_display_name || row.linked_account.name
      : null,
    monthsRemainingLabel:
      row.months_remaining != null ? `${row.months_remaining} months remaining` : null,
    showLinkedMinimumSync: row.payment_source === "linked_account_minimum",
  };
}

export type TargetComparisonStatus = "within" | "above" | "unavailable";

export type TargetComparison = {
  status: TargetComparisonStatus;
  label: string;
  meterPercent: number;
};

export function compareActualToTarget(
  actualPercent: string | null | undefined,
  targetPercent: string | null | undefined
): TargetComparison {
  if (actualPercent == null || actualPercent === "" || targetPercent == null || targetPercent === "") {
    return { status: "unavailable", label: "Not available", meterPercent: 0 };
  }
  const actual = parsePercentToHundredths(actualPercent);
  const target = parsePercentToHundredths(targetPercent);
  if (actual == null || target == null || target <= 0) {
    return { status: "unavailable", label: "Not available", meterPercent: 0 };
  }
  const meterPercent = Math.min(100, Math.round((actual / target) * 100));
  if (actual <= target) {
    return { status: "within", label: "Within your selected target", meterPercent };
  }
  const delta = centsToMoney(actual - target);
  return {
    status: "above",
    label: `${delta} percentage points above your selected target`,
    meterPercent,
  };
}

export function rankPayoffImpactsByPayment(impacts: DtiPayoffImpact[]): DtiPayoffImpact[] {
  return [...impacts].sort((a, b) => {
    const aCents = parseMoneyToCents(a.effective_monthly_payment) ?? 0;
    const bCents = parseMoneyToCents(b.effective_monthly_payment) ?? 0;
    return bCents - aCents;
  });
}

const ROW_WARNING_CODES = new Set([
  "linked_account_inactive",
  "linked_account_ineligible",
  "linked_account_minimum_unavailable",
  "linked_account_missing",
  "debt_payment_without_balance",
  "debt_balance_without_payment",
]);

const HOUSING_WARNING_CODES = new Set([
  "possible_housing_double_count",
  "current_housing_excluded",
]);

const PROPOSED_WARNING_CODES = new Set(["proposed_housing_empty"]);

export type GroupedDtiWarnings = {
  page: DtiCalculationWarning[];
  housing: DtiCalculationWarning[];
  proposed: DtiCalculationWarning[];
  byDebtId: Record<number, DtiCalculationWarning[]>;
};

export function groupDtiWarnings(warnings: DtiCalculationWarning[]): GroupedDtiWarnings {
  const grouped: GroupedDtiWarnings = {
    page: [],
    housing: [],
    proposed: [],
    byDebtId: {},
  };
  for (const warning of warnings) {
    if (warning.debt_item_id != null && ROW_WARNING_CODES.has(warning.code)) {
      const list = grouped.byDebtId[warning.debt_item_id] ?? [];
      list.push(warning);
      grouped.byDebtId[warning.debt_item_id] = list;
      continue;
    }
    if (HOUSING_WARNING_CODES.has(warning.code)) {
      grouped.housing.push(warning);
      continue;
    }
    if (PROPOSED_WARNING_CODES.has(warning.code)) {
      grouped.proposed.push(warning);
      continue;
    }
    grouped.page.push(warning);
  }
  return grouped;
}

export function payoffImpactSentence(impact: DtiPayoffImpact): string {
  const payment = formatDtiMoney(impact.effective_monthly_payment);
  const from = formatDtiPercent(impact.current_back_end_dti);
  const to = formatDtiPercent(impact.back_end_dti_after_payoff);
  return `Paying off this debt would remove its ${payment} monthly payment and reduce modeled back-end DTI from ${from} to ${to}.`;
}

export function isZeroMoney(value: string | null | undefined): boolean {
  const cents = parseMoneyToCents(value ?? "0");
  return cents === 0;
}
