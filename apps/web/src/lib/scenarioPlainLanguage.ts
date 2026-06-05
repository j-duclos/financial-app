import { formatCurrency } from "@budget-app/shared";
import type {
  ScenarioComparisonResponse,
  ScenarioRuleOverride,
  ScenarioOneTimeEvent,
  ScenarioAddedRecurring,
  ScenarioCategoryShock,
  RecurringRuleFrequency,
} from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";
import {
  isDebtScenarioEvent,
  isDebtPaymentOverride,
  isDebtRecurringPayment,
  parseDebtEventType,
  recurringDebtFrequencyLabel,
  utilizationHorizonSuffix,
} from "./scenarioDebtPayment";
import { isDebtPaymentAccount } from "./paymentPlannerDisplay";

/** Marker on rules/overrides created via What-If → new recurring (inactive in base plan). */
export const SCENARIO_ONLY_RULE_NOTE = "what_if_new_recurring";

export function isScenarioOnlyRuleAdd(ov: ScenarioRuleOverride): boolean {
  if (ov.override_active !== true) return false;
  if (ov.override_amount != null) return false;
  if (ov.override_start_date || ov.override_end_date) return false;
  if (ov.override_account != null || ov.override_category != null) return false;
  const marked =
    ov.notes?.includes(SCENARIO_ONLY_RULE_NOTE) ||
    ov.rule?.notes?.includes(SCENARIO_ONLY_RULE_NOTE);
  if (marked) return true;
  return ov.rule?.active === false;
}

function recurringCostLabel(amount: string, currency: string, frequency?: RecurringRuleFrequency): string {
  const amt = formatCurrency(amount, currency);
  switch (frequency) {
    case "WEEKLY":
      return `${amt}/week`;
    case "BIWEEKLY":
      return `${amt}/2 weeks`;
    case "YEARLY":
      return `${amt}/year`;
    default:
      return `${amt}/month`;
  }
}

function signedRecurringCostLabel(
  amount: number,
  currency: string,
  frequency?: RecurringRuleFrequency,
  sign: "+" | "-" = "+"
): string {
  const label = recurringCostLabel(String(Math.abs(amount)), currency, frequency);
  return sign === "+" ? `+${label}` : `-${label}`;
}

export function describeOverride(ov: ScenarioRuleOverride): string {
  const name = ov.rule?.name ?? "Recurring bill";
  if (ov.override_active === false) {
    return `${name} canceled`;
  }
  if (ov.override_amount != null) {
    const amt = formatCurrency(ov.override_amount, ov.rule?.currency ?? "USD");
    const base = ov.rule?.amount;
    if (base != null) {
      const baseNum = parseFloat(String(base));
      const newNum = parseFloat(ov.override_amount);
      if (!Number.isNaN(baseNum) && !Number.isNaN(newNum)) {
        if (newNum > baseNum) return `${name} increased to ${amt}`;
        if (newNum < baseNum) return `${name} decreased to ${amt}`;
      }
    }
    return `${name} changed to ${amt}`;
  }
  if (ov.override_active === true) {
    return `${name} re-enabled`;
  }
  if (ov.override_start_date || ov.override_end_date) {
    const parts = [name, "timing updated"];
    if (ov.override_start_date) parts.push(`from ${formatDateDisplay(ov.override_start_date)}`);
    if (ov.override_end_date) parts.push(`until ${formatDateDisplay(ov.override_end_date)}`);
    return parts.join(" ");
  }
  if (ov.notes?.trim()) return `${name}: ${ov.notes.trim()}`;
  return `${name} updated`;
}

export function describeOneTimeEvent(ev: ScenarioOneTimeEvent): string {
  const amt = formatCurrency(ev.amount, "USD");
  const when = formatDateDisplay(ev.date);
  const label = ev.description?.trim() || "One-time change";
  if (ev.direction === "INCOME") {
    return `Extra income of ${amt} on ${when}${label !== "One-time change" ? ` (${label})` : ""}`;
  }
  if (ev.direction === "TRANSFER") {
    const fromName = ev.account?.name ?? "account";
    const toName = ev.transfer_to_account?.name ?? "another account";
    return `Transfer ${amt} from ${fromName} to ${toName} on ${when}${label !== "One-time change" ? ` (${label})` : ""}`;
  }
  const lower = label.toLowerCase();
  if (lower.includes("payoff") || lower.includes("paid off")) {
    return `${label} on ${when} (${amt})`;
  }
  return `${label} of ${amt} on ${when}`;
}

export function describeCategoryShock(shock: ScenarioCategoryShock): string {
  const name = shock.category?.name ?? "Spending";
  const pct = parseFloat(shock.percent_change);
  const absPct = Math.abs(pct);
  const verb = pct >= 0 ? "increased" : "decreased";
  const range =
    shock.end_date != null
      ? ` from ${formatDateDisplay(shock.start_date)} to ${formatDateDisplay(shock.end_date)}`
      : ` starting ${formatDateDisplay(shock.start_date)}`;
  return `${name} ${verb} by ${absPct}%${range}`;
}

export type PlanImpactKind =
  | "one_time_expense"
  | "one_time_income"
  | "transfer"
  | "recurring"
  | "debt"
  | "spending_change";

export interface PlanIncludeItem {
  id: string;
  title: string;
  costLabel: string;
  /** Short action line for the what-changed list, e.g. "Added HBO subscription". */
  actionLabel: string;
  /** Detail line under the action, e.g. "+$25/month" or "$20 → $35". */
  detailLabel: string;
  text: string;
  sortDate: string;
  kind: "override" | "event" | "shock" | "added_recurring";
  sourceId: number;
  dateLabel: string | null;
  accountLabel: string | null;
  changePhrase: string;
  /** One-line explanation for the why section. */
  whyBullet: string;
  impactKind: PlanImpactKind;
  impactAmount: number | null;
  /** New recurring enabled only in this what-if (inactive in base plan). */
  scenarioOnlyAdd?: boolean;
  ruleDirection?: "INCOME" | "EXPENSE" | "TRANSFER";
}

function accountLabelFrom(
  account?: { name?: string } | null,
  overrideAccount?: { name?: string } | null,
  direction?: "INCOME" | "EXPENSE" | "TRANSFER" | null
): string | null {
  const name = overrideAccount?.name ?? account?.name;
  if (!name) return null;
  if (direction === "INCOME") return `Deposited to ${name}`;
  return `Paid from ${name}`;
}

function overrideChangeCard(ov: ScenarioRuleOverride): {
  title: string;
  costLabel: string;
  actionLabel: string;
  detailLabel: string;
  changePhrase: string;
  whyBullet: string;
  impactKind: PlanImpactKind;
  impactAmount: number | null;
  dateLabel: string | null;
  accountLabel: string | null;
} {
  const name = ov.rule?.name ?? "Recurring bill";
  const currency = ov.rule?.currency ?? "USD";
  const frequency = ov.rule?.frequency;
  const accountLabel = accountLabelFrom(
    ov.rule?.account,
    ov.override_account,
    ov.rule?.direction
  );

  if (isDebtPaymentOverride(ov) && ov.override_amount != null && ov.rule) {
    const baseNum = parseFloat(String(ov.rule.amount));
    const newNum = parseFloat(ov.override_amount);
    const currency = ov.rule.currency ?? "USD";
    const freqSuffix =
      ov.rule.frequency === "WEEKLY"
        ? "/week"
        : ov.rule.frequency === "BIWEEKLY"
          ? "/2 weeks"
          : ov.rule.frequency === "YEARLY"
            ? "/year"
            : "/month";
    const debtName = ov.rule.transfer_to_account?.name ?? ov.rule.name;
    return {
      title: debtName,
      costLabel: `${formatCurrency(ov.override_amount, currency)}${freqSuffix}`,
      actionLabel: `Increase ${debtName} payment`,
      detailLabel: `${formatCurrency(String(baseNum), currency)} → ${formatCurrency(ov.override_amount, currency)}${freqSuffix}`,
      changePhrase: `This raises ${debtName} payments starting ${ov.override_start_date ? formatDateDisplay(ov.override_start_date) : "the effective date"}.`,
      whyBullet: `${debtName} payment increases from ${formatCurrency(String(baseNum), currency)} to ${formatCurrency(ov.override_amount, currency)}${freqSuffix}.`,
      impactKind: "debt",
      impactAmount: Number.isNaN(newNum) || Number.isNaN(baseNum) ? null : newNum - baseNum,
      dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
      accountLabel: accountLabelFrom(ov.rule.account, ov.override_account, ov.rule.direction),
    };
  }

  if (isScenarioOnlyRuleAdd(ov) && ov.rule) {
    const baseAmt = parseFloat(String(ov.rule.amount));
    const amountNum = Number.isNaN(baseAmt) ? null : baseAmt;
    const isIncome = ov.rule.direction === "INCOME";
    const monthlyLabel = amountNum != null ? recurringCostLabel(String(amountNum), currency, frequency) : "";
    const signedLabel = isIncome ? `+${monthlyLabel}` : monthlyLabel;
    return {
      title: name,
      costLabel: signedLabel,
      actionLabel: `Added ${name}`,
      detailLabel: signedLabel,
      changePhrase: isIncome
        ? `This adds ${monthlyLabel} income in this plan.`
        : `This adds ${monthlyLabel} expense in this plan.`,
      whyBullet: isIncome
        ? `${name} adds ${monthlyLabel} income.`
        : `${name} adds ${monthlyLabel} expense.`,
      impactKind: "recurring",
      impactAmount: amountNum == null ? null : isIncome ? amountNum : -amountNum,
      dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
      accountLabel,
    };
  }

  if (ov.override_active === false) {
    const baseAmt = ov.rule?.amount;
    const saveLabel = baseAmt ? recurringCostLabel(String(baseAmt), currency, frequency) : null;
    return {
      title: name,
      costLabel: baseAmt ? `Removed · saves ${saveLabel}` : "Removed",
      actionLabel: `Removed ${name}`,
      detailLabel: saveLabel ? `saves ${saveLabel}` : "Canceled",
      changePhrase: `This cancels ${name}.`,
      whyBullet: saveLabel ? `${name} is removed, saving ${saveLabel}.` : `${name} is canceled.`,
      impactKind: "recurring",
      impactAmount: baseAmt ? -parseFloat(String(baseAmt)) : null,
      dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
      accountLabel,
    };
  }

  if (ov.override_amount != null) {
    const baseNum = ov.rule?.amount != null ? parseFloat(String(ov.rule.amount)) : null;
    const newNum = parseFloat(ov.override_amount);
    const costLabel = recurringCostLabel(ov.override_amount, currency, frequency);

    const baseFormatted = baseNum != null ? formatCurrency(String(baseNum), currency) : null;
    const newFormatted = formatCurrency(ov.override_amount, currency);
    const freqSuffix =
      frequency === "WEEKLY"
        ? "/week"
        : frequency === "BIWEEKLY"
          ? "/2 weeks"
          : frequency === "YEARLY"
            ? "/year"
            : "/month";

    if (baseNum != null && !Number.isNaN(baseNum) && !Number.isNaN(newNum)) {
      if (newNum > baseNum) {
        const delta = newNum - baseNum;
        const lower = name.toLowerCase();
        const isDebt = isDebtPaymentOverride(ov);
        return {
          title: name,
          costLabel: signedRecurringCostLabel(delta, currency, frequency, "+"),
          actionLabel: isDebt ? `Increase ${name} payment` : `Increased ${name}`,
          detailLabel: baseFormatted ? `${baseFormatted} → ${newFormatted}` : signedRecurringCostLabel(delta, currency, frequency, "+"),
          changePhrase: `This increases ${name} to ${newFormatted}.`,
          whyBullet: isDebt
            ? `${name} payments increase by ${formatCurrency(String(delta), currency)}${freqSuffix}.`
            : `${name} adds ${formatCurrency(String(delta), currency)}${freqSuffix}.`,
          impactKind: "recurring",
          impactAmount: newNum - baseNum,
          dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
          accountLabel,
        };
      }
      if (newNum < baseNum) {
        const delta = baseNum - newNum;
        return {
          title: name,
          costLabel: signedRecurringCostLabel(-delta, currency, frequency, "-"),
          actionLabel: `Decreased ${name}`,
          detailLabel: baseFormatted ? `${baseFormatted} → ${newFormatted}` : signedRecurringCostLabel(-delta, currency, frequency, "-"),
          changePhrase: `This reduces ${name} to ${newFormatted}.`,
          whyBullet: `${name} drops by ${formatCurrency(String(delta), currency)}${freqSuffix}.`,
          impactKind: "recurring",
          impactAmount: newNum - baseNum,
          dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
          accountLabel,
        };
      }
    }

    const lower = name.toLowerCase();
    const isSubscription =
      lower.includes("subscription") ||
      ov.rule?.is_bill === true ||
      (ov.notes?.toLowerCase().includes("subscription") ?? false);

    return {
      title: name,
      costLabel,
      actionLabel: isSubscription ? `Added ${name} subscription` : `Changed ${name}`,
      detailLabel: signedRecurringCostLabel(newNum, currency, frequency, "+"),
      changePhrase: isSubscription
        ? `This adds ${name} for ${costLabel}.`
        : `This changes ${name} to ${costLabel}.`,
      whyBullet: isSubscription
        ? `${name} adds ${costLabel.replace(/^\+\s?/, "")}.`
        : `${name} changes to ${costLabel}.`,
      impactKind: "recurring",
      impactAmount: newNum,
      dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
      accountLabel,
    };
  }

  return {
    title: name,
    costLabel: ov.notes?.trim() || "Details updated",
    actionLabel: `Updated ${name}`,
    detailLabel: ov.notes?.trim() || "Details updated",
    changePhrase: `This updates ${name}.`,
    whyBullet: `${name} is updated.`,
    impactKind: "recurring",
    impactAmount: null,
    dateLabel: ov.override_start_date ? formatDateDisplay(ov.override_start_date) : null,
    accountLabel,
  };
}

function oneTimeChangeCard(ev: ScenarioOneTimeEvent): {
  title: string;
  costLabel: string;
  actionLabel: string;
  detailLabel: string;
  changePhrase: string;
  whyBullet: string;
  impactKind: PlanImpactKind;
  impactAmount: number | null;
  dateLabel: string;
  accountLabel: string | null;
} {
  const amt = formatCurrency(ev.amount, "USD");
  const amountNum = parseFloat(ev.amount);
  const label = ev.description?.trim() || "One-time change";
  const lower = label.toLowerCase();
  const dateLabel = formatDateDisplay(ev.date);
  const accountLabel = accountLabelFrom(ev.account);

  if (ev.direction === "INCOME") {
    return {
      title: label,
      costLabel: `+${amt} one-time`,
      actionLabel: label !== "One-time change" ? `Added ${label}` : "Added income",
      detailLabel: `+${amt} on ${dateLabel}`,
      changePhrase: `This adds ${amt} income on ${dateLabel}.`,
      whyBullet: `${label !== "One-time change" ? label : "Extra income"} adds ${amt} on ${dateLabel}.`,
      impactKind: "one_time_income",
      impactAmount: Number.isNaN(amountNum) ? null : amountNum,
      dateLabel,
      accountLabel: accountLabel?.replace("Paid from", "Deposited to") ?? null,
    };
  }

  if (ev.direction === "TRANSFER") {
    const fromName = ev.account?.name ?? "account";
    const toName = ev.transfer_to_account?.name ?? "another account";
    const toAccount = ev.transfer_to_account;
    if (isDebtScenarioEvent(ev) && toAccount && isDebtPaymentAccount(toAccount)) {
      const debtType = parseDebtEventType(ev);
      const payFull = debtType === "pay_full";
      return {
        title: toName,
        costLabel: payFull ? `Pay off ${amt}` : `${amt} debt payment`,
        actionLabel: payFull ? `Pay off ${toName} in full` : `Pay ${amt} toward ${toName}`,
        detailLabel: payFull ? `Paid in full on ${dateLabel}` : `-${amt} on ${dateLabel}`,
        changePhrase: payFull
          ? `This pays off ${toName} using ${fromName} on ${dateLabel}.`
          : `This pays ${amt} from ${fromName} to ${toName} on ${dateLabel}.`,
        whyBullet: payFull
          ? `${toName} is paid off on ${dateLabel} — not counted as spending.`
          : `${amt} reduces ${toName} balance on ${dateLabel}.`,
        impactKind: "debt",
        impactAmount: Number.isNaN(amountNum) ? null : amountNum,
        dateLabel,
        accountLabel: `${fromName} → ${toName}`,
      };
    }
    return {
      title: label !== "One-time change" ? label : "Transfer",
      costLabel: `${amt} transfer`,
      actionLabel: `Transfer from ${fromName} to ${toName}`,
      detailLabel: `${amt} on ${dateLabel}`,
      changePhrase: `This moves ${amt} from ${fromName} to ${toName} on ${dateLabel}.`,
      whyBullet: `${amt} moves from ${fromName} to ${toName} on ${dateLabel}.`,
      impactKind: "transfer",
      impactAmount: Number.isNaN(amountNum) ? null : amountNum,
      dateLabel,
      accountLabel: `${fromName} → ${toName}`,
    };
  }

  if (lower.includes("payoff") || lower.includes("paid off") || lower.includes("pay off")) {
    return {
      title: label,
      costLabel: `${amt} lump sum`,
      actionLabel: `Paid toward ${label}`,
      detailLabel: `-${amt} on ${dateLabel}`,
      changePhrase: `This pays ${amt} toward debt on ${dateLabel}.`,
      whyBullet: `${amt} goes toward debt on ${dateLabel}.`,
      impactKind: "debt",
      impactAmount: Number.isNaN(amountNum) ? null : amountNum,
      dateLabel,
      accountLabel,
    };
  }

  return {
    title: label,
    costLabel: `${amt} one-time expense`,
    actionLabel: label !== "One-time change" ? `Added ${label}` : "Added one-time expense",
    detailLabel: `-${amt} on ${dateLabel}`,
    changePhrase: `This adds ${label} for ${amt} on ${dateLabel}.`,
    whyBullet: `${label !== "One-time change" ? label : "This expense"} costs ${amt} on ${dateLabel}.`,
    impactKind: "one_time_expense",
    impactAmount: Number.isNaN(amountNum) ? null : amountNum,
    dateLabel,
    accountLabel,
  };
}

function shockChangeCard(shock: ScenarioCategoryShock): {
  title: string;
  costLabel: string;
  actionLabel: string;
  detailLabel: string;
  changePhrase: string;
  whyBullet: string;
  impactKind: PlanImpactKind;
  impactAmount: number | null;
  dateLabel: string;
  accountLabel: null;
} {
  const name = shock.category?.name ?? "Spending";
  const pct = parseFloat(shock.percent_change);
  const absPct = Math.abs(pct);
  const direction = pct >= 0 ? "Increase" : "Reduce";
  const dateLabel =
    shock.end_date != null
      ? `${formatDateDisplay(shock.start_date)} – ${formatDateDisplay(shock.end_date)}`
      : formatDateDisplay(shock.start_date);

  return {
    title: `${name} spending`,
    costLabel: `${pct >= 0 ? "+" : "-"}${absPct}%`,
    actionLabel: `${direction} ${name} spending`,
    detailLabel: `${pct >= 0 ? "+" : "-"}${absPct}% · ${dateLabel}`,
    changePhrase: `This ${pct >= 0 ? "increases" : "reduces"} ${name} spending by ${absPct}%.`,
    whyBullet: `${name} spending ${pct >= 0 ? "rises" : "falls"} by ${absPct}%.`,
    impactKind: "spending_change",
    impactAmount: null,
    dateLabel,
    accountLabel: null,
  };
}

function addedRecurringChangeCard(added: ScenarioAddedRecurring): {
  title: string;
  costLabel: string;
  actionLabel: string;
  detailLabel: string;
  changePhrase: string;
  whyBullet: string;
  impactKind: PlanImpactKind;
  impactAmount: number | null;
  dateLabel: string | null;
  accountLabel: string | null;
} {
  const name = added.name;
  const currency = added.currency ?? "USD";
  const frequency = added.frequency as RecurringRuleFrequency;
  const amountNum = parseFloat(added.amount);
  const amtLabel = Number.isNaN(amountNum)
    ? added.amount
    : formatCurrency(String(amountNum), currency);

  if (isDebtRecurringPayment(added)) {
    const fromName = added.account?.name ?? "Source";
    const toName = added.transfer_to_account?.name ?? "Debt";
    const freqLabel = recurringDebtFrequencyLabel(added.frequency, added.notes);
    const route = `${fromName} → ${toName}`;
    return {
      title: name,
      costLabel: `${amtLabel} ${freqLabel}`,
      actionLabel: name,
      detailLabel: `${amtLabel} ${freqLabel}\n${route}`,
      changePhrase: `This adds ${amtLabel} ${freqLabel} from ${fromName} to ${toName} in this plan only.`,
      whyBullet: `${name}: ${amtLabel} ${freqLabel} (${route}) — reduces debt, not spending.`,
      impactKind: "debt",
      impactAmount: Number.isNaN(amountNum) ? null : amountNum,
      dateLabel: formatDateDisplay(added.start_date),
      accountLabel: route,
    };
  }

  const monthlyLabel = Number.isNaN(amountNum)
    ? added.amount
    : recurringCostLabel(String(amountNum), currency, frequency);
  const isIncome = added.direction === "INCOME";
  const signedLabel = isIncome ? `+${monthlyLabel}` : monthlyLabel;
  const accountLabel = accountLabelFrom(added.account);

  return {
    title: name,
    costLabel: signedLabel,
    actionLabel: `Added ${name}`,
    detailLabel: signedLabel,
    changePhrase: isIncome
      ? `This adds ${monthlyLabel} income in this plan only.`
      : `This adds ${monthlyLabel} expense in this plan only.`,
    whyBullet: isIncome ? `${name} adds ${monthlyLabel} income.` : `${name} adds ${monthlyLabel} expense.`,
    impactKind: "recurring",
    impactAmount: Number.isNaN(amountNum) ? null : isIncome ? amountNum : -amountNum,
    dateLabel: formatDateDisplay(added.start_date),
    accountLabel,
  };
}

export function buildPlanIncludes(
  overrides: ScenarioRuleOverride[],
  events: ScenarioOneTimeEvent[],
  shocks: ScenarioCategoryShock[],
  addedRecurring: ScenarioAddedRecurring[] = []
): PlanIncludeItem[] {
  const items: PlanIncludeItem[] = [
    ...overrides.map((ov) => {
      const card = overrideChangeCard(ov);
      return {
        id: `ov-${ov.id}`,
        title: card.title,
        costLabel: card.costLabel,
        actionLabel: card.actionLabel,
        detailLabel: card.detailLabel,
        text: `${card.title} — ${card.costLabel}`,
        sortDate: ov.override_start_date ?? "9999-12-31",
        kind: "override" as const,
        sourceId: ov.id,
        dateLabel: card.dateLabel,
        accountLabel: card.accountLabel,
        changePhrase: card.changePhrase,
        whyBullet: card.whyBullet,
        impactKind: card.impactKind,
        impactAmount: card.impactAmount,
        scenarioOnlyAdd: isScenarioOnlyRuleAdd(ov),
        ruleDirection: ov.rule?.direction,
      };
    }),
    ...events.map((ev) => {
      const card = oneTimeChangeCard(ev);
      return {
        id: `ev-${ev.id}`,
        title: card.title,
        costLabel: card.costLabel,
        actionLabel: card.actionLabel,
        detailLabel: card.detailLabel,
        text: `${card.title} — ${card.costLabel}`,
        sortDate: ev.date,
        kind: "event" as const,
        sourceId: ev.id,
        dateLabel: card.dateLabel,
        accountLabel: card.accountLabel,
        changePhrase: card.changePhrase,
        whyBullet: card.whyBullet,
        impactKind: card.impactKind,
        impactAmount: card.impactAmount,
      };
    }),
    ...addedRecurring.map((added) => {
      const card = addedRecurringChangeCard(added);
      return {
        id: `ar-${added.id}`,
        title: card.title,
        costLabel: card.costLabel,
        actionLabel: card.actionLabel,
        detailLabel: card.detailLabel,
        text: `${card.title} — ${card.costLabel}`,
        sortDate: added.start_date,
        kind: "added_recurring" as const,
        sourceId: added.id,
        dateLabel: card.dateLabel,
        accountLabel: card.accountLabel,
        changePhrase: card.changePhrase,
        whyBullet: card.whyBullet,
        impactKind: card.impactKind,
        impactAmount: card.impactAmount,
        scenarioOnlyAdd: true,
        ruleDirection: added.direction,
      };
    }),
    ...shocks.map((sh) => {
      const card = shockChangeCard(sh);
      return {
        id: `sh-${sh.id}`,
        title: card.title,
        costLabel: card.costLabel,
        actionLabel: card.actionLabel,
        detailLabel: card.detailLabel,
        text: `${card.title} — ${card.costLabel}`,
        sortDate: sh.start_date,
        kind: "shock" as const,
        sourceId: sh.id,
        dateLabel: card.dateLabel,
        accountLabel: card.accountLabel,
        changePhrase: card.changePhrase,
        whyBullet: card.whyBullet,
        impactKind: card.impactKind,
        impactAmount: card.impactAmount,
      };
    }),
  ];
  return items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}

/** e.g. "$1,835.52 → $2,500.00" → "Changes PAYROLL from $1,835.52 to $2,500.00" */
function recurringOverrideChangeLine(title: string, detail: string): string {
  const arrow = detail.indexOf("→");
  if (arrow >= 0) {
    const from = detail.slice(0, arrow).trim();
    const to = detail.slice(arrow + 1).trim();
    if (from && to) {
      return `Changes ${title} from ${from} to ${to}`;
    }
  }
  return `Changes ${title} to ${detail}`;
}

/** Impact bullet for risky plans, e.g. "Adds $75/month expense". */
export function planItemRiskImpactLine(item: PlanIncludeItem): string | null {
  const amt =
    item.impactAmount != null
      ? formatCurrency(String(Math.abs(item.impactAmount)), "USD")
      : null;
  const date = item.dateLabel;
  const detail = item.detailLabel.trim();

  switch (item.impactKind) {
    case "one_time_income":
      if (amt && date) return `Adds ${amt} income on ${date}`;
      return item.detailLabel.replace(/^\+\s*/, "Adds ");
    case "debt": {
      if (item.detailLabel.includes("→") && item.detailLabel.includes("/")) {
        const lines = item.detailLabel.split("\n");
        return lines[0] ?? item.actionLabel;
      }
      if (item.actionLabel.toLowerCase().includes("pay off")) {
        return item.actionLabel;
      }
      if (item.actionLabel.toLowerCase().includes("increase") && item.detailLabel.includes("→")) {
        return item.actionLabel;
      }
      if (amt && date) return `Pays ${amt} toward debt on ${date}`;
      if (amt) return `Pays ${amt} toward debt`;
      return item.detailLabel.replace(/^-\s*/, "Pays ");
    }
    case "one_time_expense":
      if (amt && date) return `Adds ${amt} expense on ${date}`;
      if (amt) return `Adds ${amt} expense`;
      return item.detailLabel.replace(/^-\s*/, "Adds ");
    case "transfer":
      return item.actionLabel;
    case "recurring": {
      const monthlyMatch = detail.match(/^\+?([^+]+?\/month)/i);
      if (monthlyMatch) {
        const suffix =
          item.scenarioOnlyAdd && item.ruleDirection === "INCOME" ? " income" : " expense";
        return `Adds ${monthlyMatch[1]}${suffix}`;
      }
      const weeklyMatch = detail.match(/^\+?([^+]+?\/week)/i);
      if (weeklyMatch) {
        return `Adds ${weeklyMatch[1]} expense`;
      }
      if (detail.includes("→")) {
        return recurringOverrideChangeLine(item.title, detail);
      }
      if (item.actionLabel.startsWith("Removed")) {
        return `Removes ${item.title}`;
      }
      if (amt != null && amt) {
        return `Adds ${amt}/month expense`;
      }
      return item.actionLabel;
    }
    case "spending_change":
      return item.actionLabel;
    default:
      return item.actionLabel;
  }
}

/** Summary bullet for one plan change, with debt utilization at horizon when available. */
export function planItemChangeImpactLine(
  item: PlanIncludeItem,
  comparison: ScenarioComparisonResponse | undefined
): string | null {
  const base = planItemSummaryHighlight(item);
  if (!base) return null;
  const suffix = utilizationHorizonSuffix(item, comparison);
  return suffix ? `${base}; ${suffix}` : base;
}

/** Short checkmark line for the plan summary card, e.g. "Adds $1,500 on 05-30-26". */
export function planItemSummaryHighlight(item: PlanIncludeItem): string | null {
  const amt =
    item.impactAmount != null
      ? formatCurrency(String(Math.abs(item.impactAmount)), "USD")
      : null;
  const date = item.dateLabel;

  switch (item.impactKind) {
    case "one_time_income":
      if (amt && date) return `Adds ${amt} on ${date}`;
      return item.detailLabel.replace(/^\+\s*/, "Adds ");
    case "debt": {
      if (item.detailLabel.includes("→")) {
        const freqLine = item.detailLabel.split("\n")[0] ?? item.detailLabel;
        if (freqLine.includes("month") || freqLine.includes("week")) {
          return `${item.actionLabel} — ${freqLine}`;
        }
        return item.accountLabel ?? item.actionLabel;
      }
      if (item.actionLabel.toLowerCase().includes("pay off")) {
        return item.actionLabel;
      }
      if (amt && date) return `Pays ${amt} toward debt on ${date}`;
      return item.detailLabel.replace(/^-\s*/, "Pays ");
    }
    case "one_time_expense":
      if (amt && date) return `Costs ${amt} on ${date}`;
      return item.detailLabel.replace(/^-\s*/, "Costs ");
    case "transfer":
      return item.actionLabel;
    case "recurring": {
      const detail = item.detailLabel.trim();
      if (item.actionLabel.startsWith("Removed")) {
        const saveMatch = item.costLabel.match(/saves\s+(.+)/i);
        return saveMatch ? `Stops ${item.title} — ${saveMatch[1]}` : `Stops ${item.title}`;
      }
      if (detail.includes("→") && item.impactAmount != null && item.impactAmount < -0.005) {
        const saved = formatCurrency(String(Math.abs(item.impactAmount)), "USD");
        return `Lowers ${item.title} — saves ${saved}/month`;
      }
      const monthlyMatch = detail.match(/^\+?([^+]+?\/month)/i);
      if (monthlyMatch) {
        const suffix =
          item.scenarioOnlyAdd && item.ruleDirection === "INCOME" ? " income" : " expense";
        return `Adds ${monthlyMatch[1]}${suffix}`;
      }
      if (detail.includes("→")) {
        return recurringOverrideChangeLine(item.title, detail);
      }
      return item.actionLabel;
    }
    case "spending_change":
      return item.actionLabel;
    default:
      return item.actionLabel;
  }
}
