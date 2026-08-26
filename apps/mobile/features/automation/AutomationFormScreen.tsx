import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRule,
  getProfile,
  getRule,
  listAccounts,
  listCategories,
  listHouseholds,
  pauseRule,
  resumeRule,
  updateRule,
} from "@budget-app/api-client";
import type { RecurringRule, RecurringRuleFrequency } from "@budget-app/shared";
import { formatAccountOptionLabel } from "@budget-app/shared";
import { AppHeader, Button, Card, ErrorState, Screen, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateRecurringRuleDependents } from "@/lib/financialQueryRefresh";
import { todayStr } from "@/lib/dates";
import { accountLifecycleStatus } from "@/lib/accountGroups";
import { automationQueryKeys } from "./queryKeys";
import {
  buildRuleSummary,
  getRuleLifecycleStatus,
  lifecycleToActiveAndEndDate,
  type RuleLifecycleStatus,
} from "./automationDisplay";
import { RuleSummaryCard } from "./components/RuleSummaryCard";

type Direction = "INCOME" | "EXPENSE" | "TRANSFER";
type FormStep = "basics" | "schedule" | "conditions" | "review";

const STEPS: { key: FormStep; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "schedule", label: "Schedule" },
  { key: "conditions", label: "Accounts" },
  { key: "review", label: "Review" },
];

const FREQUENCIES: { value: RecurringRuleFrequency; label: string }[] = [
  { value: "MONTHLY_DAY", label: "Monthly" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY_NTH_WEEKDAY", label: "Monthly (weekday)" },
  { value: "YEARLY", label: "Yearly" },
];

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

const NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
];

type FormState = {
  name: string;
  household: number;
  account_id: number;
  transfer_to_account_id: number | null;
  category_id: number | null;
  direction: Direction;
  amount: string;
  currency: string;
  frequency: RecurringRuleFrequency;
  interval: number;
  day_of_week: number | null;
  day_of_month: number;
  nth_week: number | null;
  start_date: string;
  end_date: string;
  lifecycleStatus: RuleLifecycleStatus;
  notes: string;
  is_bill: boolean;
  scheduleChangeLater: boolean;
  changeEffectiveDate: string;
};

function defaultForm(householdId = 0): FormState {
  return {
    name: "",
    household: householdId,
    account_id: 0,
    transfer_to_account_id: null,
    category_id: null,
    direction: "EXPENSE",
    amount: "",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: 0,
    day_of_month: 15,
    nth_week: 1,
    start_date: todayStr(),
    end_date: "",
    lifecycleStatus: "running",
    notes: "",
    is_bill: false,
    scheduleChangeLater: false,
    changeEffectiveDate: "",
  };
}

function ruleToForm(rule: RecurringRule): FormState {
  const sched = rule.scheduled_change;
  const source = sched ?? rule;
  const rawInterval = Math.max(1, Number(source.interval) || 1);
  const normalizedFrequency: RecurringRuleFrequency =
    source.frequency === "BIWEEKLY" ? "WEEKLY" : source.frequency;
  const normalizedInterval = source.frequency === "BIWEEKLY" ? rawInterval * 2 : rawInterval;

  return {
    name: rule.name,
    household: typeof rule.household === "object" ? (rule.household as { id: number }).id : rule.household,
    account_id: sched?.account_id ?? rule.account?.id ?? 0,
    transfer_to_account_id: sched?.transfer_to_account_id ?? rule.transfer_to_account?.id ?? null,
    category_id: sched?.category_id ?? rule.category?.id ?? null,
    direction: (sched?.direction ?? rule.direction) as Direction,
    amount: sched?.amount ?? rule.amount,
    currency: sched?.currency ?? rule.currency ?? "USD",
    frequency: normalizedFrequency,
    interval: normalizedInterval,
    day_of_week: source.day_of_week ?? 0,
    day_of_month: source.day_of_month ?? 15,
    nth_week: source.nth_week ?? 1,
    start_date: (sched?.start_date ?? rule.start_date).slice(0, 10),
    end_date: (sched?.end_date ?? rule.end_date)?.slice(0, 10) ?? "",
    lifecycleStatus: getRuleLifecycleStatus(rule, todayStr()),
    notes: rule.notes ?? "",
    is_bill: rule.is_bill ?? false,
    scheduleChangeLater: !!sched,
    changeEffectiveDate: sched?.effective_from?.slice(0, 10) ?? "",
  };
}

function formToPreviewRule(form: FormState): RecurringRule {
  return {
    id: 0,
    household: form.household,
    name: form.name || "New rule",
    account: { id: form.account_id, name: "Account" } as RecurringRule["account"],
    transfer_to_account: form.transfer_to_account_id
      ? ({ id: form.transfer_to_account_id, name: "Destination" } as RecurringRule["transfer_to_account"])
      : null,
    category: form.category_id ? ({ id: form.category_id, name: "Category" } as RecurringRule["category"]) : null,
    direction: form.direction,
    amount: form.amount || "0",
    currency: form.currency,
    frequency: form.frequency,
    interval: form.interval,
    day_of_week: form.day_of_week,
    day_of_month: form.day_of_month,
    nth_week: form.nth_week,
    start_date: form.start_date,
    end_date: form.end_date || null,
    active: form.lifecycleStatus === "running",
    paused_at: null,
    notes: form.notes,
    is_bill: form.is_bill,
    created_at: todayStr(),
    updated_at: todayStr(),
  };
}

export function AutomationFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId) && editingId > 0;
  const [step, setStep] = useState<FormStep>("basics");
  const [form, setForm] = useState<FormState>(() => defaultForm());
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => getProfile() });
  const householdsQuery = useQuery({ queryKey: ["households"], queryFn: () => listHouseholds() });
  const ruleQuery = useQuery({
    queryKey: automationQueryKeys.detail(editingId ?? 0),
    queryFn: () => getRule(editingId!),
    enabled: isEdit,
  });

  const householdId =
    form.household || profileQuery.data?.default_household || householdsQuery.data?.[0]?.id || 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", "automation-form", householdId],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    enabled: step === "conditions" || step === "review",
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", "automation-form", householdId],
    queryFn: () => listCategories({ household: householdId, page_size: 500 }),
    enabled: (step === "conditions" || step === "review") && householdId > 0,
  });

  const accounts = useMemo(
    () =>
      (accountsQuery.data?.results ?? []).filter(
        (a) => accountLifecycleStatus(a) === "active" && a.household?.id === householdId
      ),
    [accountsQuery.data?.results, householdId]
  );

  const categories = categoriesQuery.data?.results ?? [];
  const selectedCategory = categories.find((c) => c.id === form.category_id);
  const catName = selectedCategory?.name ?? "";
  const transferAllowed = catName === "Credit Card Payment" || catName === "Bank Transfer";
  const creditCardAccounts = accounts.filter(
    (a) => a.account_type === "CREDIT" && a.id !== form.account_id
  );

  useEffect(() => {
    if (!householdId || form.household) return;
    setForm((f) => ({ ...f, household: householdId }));
  }, [householdId, form.household]);

  useEffect(() => {
    if (ruleQuery.data) setForm(ruleToForm(ruleQuery.data));
  }, [ruleQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const today = todayStr();
      const { active, end_date } = lifecycleToActiveAndEndDate(form.lifecycleStatus, form.end_date, today);

      const payload: Record<string, unknown> = {
        household: form.household || householdId,
        name: form.name.trim(),
        account_id: form.account_id,
        transfer_to_account_id: transferAllowed ? form.transfer_to_account_id : null,
        category_id: form.category_id,
        direction: form.direction,
        amount: form.amount.trim(),
        currency: form.currency,
        frequency: form.frequency,
        interval: form.interval,
        day_of_week:
          form.frequency === "WEEKLY" || form.frequency === "BIWEEKLY" || form.frequency === "MONTHLY_NTH_WEEKDAY"
            ? form.day_of_week
            : null,
        day_of_month:
          form.frequency === "MONTHLY_DAY" || form.frequency === "MONTHLY_NTH_WEEKDAY"
            ? form.day_of_month
            : undefined,
        nth_week: form.frequency === "MONTHLY_NTH_WEEKDAY" ? form.nth_week : undefined,
        start_date: form.start_date,
        end_date,
        active,
        notes: form.notes.trim() || null,
        is_bill: form.is_bill,
      };

      if (isEdit && form.scheduleChangeLater) {
        const eff = form.changeEffectiveDate.slice(0, 10);
        if (!eff || eff <= today) {
          throw new Error("Choose an effective date after today to schedule a later change.");
        }
        payload.change_effective_date = eff;
      }

      if (isEdit) {
        const editing = ruleQuery.data!;
        const wasPaused = getRuleLifecycleStatus(editing, today) === "paused";
        const runUpdate = () => updateRule(editingId!, payload);

        if (form.lifecycleStatus === "running" && wasPaused) {
          await resumeRule(editingId!);
          return runUpdate();
        }
        if (form.lifecycleStatus === "paused" && !wasPaused) {
          await pauseRule(editingId!);
          return runUpdate();
        }
        return runUpdate();
      }

      return createRule(payload as Parameters<typeof createRule>[0]);
    },
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
      router.back();
    },
    onError: (err: Error) => setError(err.message || "Could not save automation rule"),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  function validateStep(current: FormStep): string | null {
    if (current === "basics") {
      if (!form.name.trim()) return "Rule name is required.";
      if (!form.amount.trim() || Number.isNaN(Number(form.amount))) return "Enter a valid amount.";
    }
    if (current === "schedule") {
      if (!form.start_date) return "Start date is required.";
    }
    if (current === "conditions") {
      if (!form.account_id) return "Select an account.";
      if (transferAllowed && catName === "Bank Transfer" && !form.transfer_to_account_id) {
        return "Select a transfer destination account.";
      }
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.key);
  }

  function goBack() {
    setError(null);
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.key);
    else router.back();
  }

  if (isEdit && ruleQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Edit automation" onBack={() => router.back()} />
      </Screen>
    );
  }

  if (isEdit && ruleQuery.isError) {
    return (
      <Screen>
        <ErrorState message={describeApiError(ruleQuery.error)} onRetry={() => ruleQuery.refetch()} />
      </Screen>
    );
  }

  const previewRule = formToPreviewRule(form);

  return (
    <Screen scroll={false}>
      <AppHeader
        title={isEdit ? "Edit automation" : "Create automation"}
        onBack={() => (stepIndex === 0 ? router.back() : goBack())}
      />

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: theme.spacing.lg, marginBottom: 8 }}>
        {STEPS.map((s, i) => (
          <View
            key={s.key}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= stepIndex ? theme.colors.tint : theme.colors.border,
            }}
            accessibilityElementsHidden
          />
        ))}
      </View>
      <Text style={{ color: theme.colors.textMuted, paddingHorizontal: theme.spacing.lg, marginBottom: 8, fontSize: 12 }}>
        Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex].label}
      </Text>

      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: 32 }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}

        {isEdit ? (
          <Card>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              Changes apply to future occurrences only. Past ledger rows stay as-is.
            </Text>
          </Card>
        ) : null}

        {step === "basics" ? (
          <>
            <TextField label="Rule name" value={form.name} onChangeText={(v) => set("name", v)} />
            <ChipRow
              label="Action type"
              options={[
                { value: "EXPENSE", label: "Expense" },
                { value: "INCOME", label: "Income" },
                { value: "TRANSFER", label: "Transfer" },
              ]}
              selected={form.direction}
              onSelect={(v) => set("direction", v as Direction)}
            />
            <TextField
              label="Amount"
              value={form.amount}
              onChangeText={(v) => set("amount", v)}
              keyboardType="decimal-pad"
            />
            <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>
              This rule will create {form.direction === "INCOME" ? "income" : form.direction === "TRANSFER" ? "transfer" : "expense"} transactions on the backend schedule — not immediately on save.
            </Text>
          </>
        ) : null}

        {step === "schedule" ? (
          <>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>Trigger: schedule</Text>
            <ChipRow
              label="Frequency"
              options={FREQUENCIES.filter((f) => f.value !== "BIWEEKLY").map((f) => ({
                value: f.value,
                label: f.label,
              }))}
              selected={form.frequency}
              onSelect={(v) => set("frequency", v as RecurringRuleFrequency)}
            />
            {form.frequency === "WEEKLY" ? (
              <>
                <TextField
                  label="Every N weeks"
                  value={String(form.interval)}
                  onChangeText={(v) => set("interval", Math.max(1, Number(v) || 1))}
                  keyboardType="number-pad"
                />
                <ChipRow
                  label="Day of week"
                  options={WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label }))}
                  selected={String(form.day_of_week ?? 0)}
                  onSelect={(v) => set("day_of_week", Number(v))}
                />
              </>
            ) : null}
            {form.frequency === "MONTHLY_DAY" ? (
              <TextField
                label="Day of month (1–31)"
                value={String(form.day_of_month)}
                onChangeText={(v) => set("day_of_month", Math.min(31, Math.max(1, Number(v) || 1)))}
                keyboardType="number-pad"
              />
            ) : null}
            {form.frequency === "MONTHLY_NTH_WEEKDAY" ? (
              <>
                <ChipRow
                  label="Week of month"
                  options={NTH.map((n) => ({ value: String(n.value), label: n.label }))}
                  selected={String(form.nth_week ?? 1)}
                  onSelect={(v) => set("nth_week", Number(v))}
                />
                <ChipRow
                  label="Weekday"
                  options={WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label }))}
                  selected={String(form.day_of_week ?? 0)}
                  onSelect={(v) => set("day_of_week", Number(v))}
                />
              </>
            ) : null}
            <TextField label="Start date (YYYY-MM-DD)" value={form.start_date} onChangeText={(v) => set("start_date", v)} />
            <TextField
              label="End date (optional)"
              value={form.end_date}
              onChangeText={(v) => set("end_date", v)}
              placeholder="Leave blank for ongoing"
            />
          </>
        ) : null}

        {step === "conditions" ? (
          <>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: "600" }}>Conditions: accounts & category</Text>
            <ChipRow
              label="From account"
              options={accounts.map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
              selected={String(form.account_id || "")}
              onSelect={(v) => set("account_id", Number(v))}
            />
            {form.direction !== "TRANSFER" ? (
              <ChipRow
                label="Category"
                options={[
                  { value: "", label: "None" },
                  ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                ]}
                selected={String(form.category_id ?? "")}
                onSelect={(v) => {
                  set("category_id", v ? Number(v) : null);
                  set("transfer_to_account_id", null);
                }}
              />
            ) : null}
            {transferAllowed && catName === "Credit Card Payment" && creditCardAccounts.length > 0 ? (
              <ChipRow
                label="Pay to credit card"
                options={creditCardAccounts.map((a) => ({
                  value: String(a.id),
                  label: formatAccountOptionLabel(a),
                }))}
                selected={String(form.transfer_to_account_id ?? "")}
                onSelect={(v) => set("transfer_to_account_id", Number(v))}
              />
            ) : null}
            {transferAllowed && catName === "Bank Transfer" ? (
              <ChipRow
                label="Transfer to account"
                options={accounts
                  .filter((a) => a.id !== form.account_id)
                  .map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
                selected={String(form.transfer_to_account_id ?? "")}
                onSelect={(v) => set("transfer_to_account_id", Number(v))}
              />
            ) : null}
            {form.direction === "TRANSFER" ? (
              <ChipRow
                label="Transfer to"
                options={accounts
                  .filter((a) => a.id !== form.account_id)
                  .map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
                selected={String(form.transfer_to_account_id ?? "")}
                onSelect={(v) => set("transfer_to_account_id", Number(v))}
              />
            ) : null}
            <ChipRow
              label="Include on bill checklist"
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
              selected={form.is_bill ? "yes" : "no"}
              onSelect={(v) => set("is_bill", v === "yes")}
            />
            <TextField label="Notes (optional)" value={form.notes} onChangeText={(v) => set("notes", v)} multiline />
          </>
        ) : null}

        {step === "review" ? (
          <>
            <RuleSummaryCard rule={previewRule} />
            <Card>
              <Text style={{ color: theme.colors.text, fontWeight: "600", marginBottom: 8 }}>Plain-language summary</Text>
              <Text style={{ color: theme.colors.textSecondary, lineHeight: 20 }}>{buildRuleSummary(previewRule)}</Text>
            </Card>
            <ChipRow
              label="Status"
              options={[
                { value: "running", label: "Running" },
                { value: "paused", label: "Paused" },
                { value: "ended", label: "Ended" },
              ]}
              selected={form.lifecycleStatus}
              onSelect={(v) => set("lifecycleStatus", v as RuleLifecycleStatus)}
            />
            {isEdit ? (
              <>
                <ChipRow
                  label="Apply amount/cadence changes"
                  options={[
                    { value: "now", label: "Immediately" },
                    { value: "later", label: "Schedule for later" },
                  ]}
                  selected={form.scheduleChangeLater ? "later" : "now"}
                  onSelect={(v) => set("scheduleChangeLater", v === "later")}
                />
                {form.scheduleChangeLater ? (
                  <TextField
                    label="Effective date (after today)"
                    value={form.changeEffectiveDate}
                    onChangeText={(v) => set("changeEffectiveDate", v)}
                  />
                ) : null}
              </>
            ) : null}
            <Button
              label={isEdit ? "Save automation" : "Create automation"}
              loading={saveMutation.isPending}
              onPress={() => {
                const err = validateStep("basics") || validateStep("schedule") || validateStep("conditions");
                if (err) {
                  setError(err);
                  return;
                }
                setError(null);
                saveMutation.mutate();
              }}
            />
          </>
        ) : null}

        {step !== "review" ? (
          <Button label="Continue" onPress={goNext} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === opt.value }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: selected === opt.value ? theme.colors.tintMuted : theme.colors.surfaceMuted,
              borderWidth: 1,
              borderColor: selected === opt.value ? theme.colors.tint : theme.colors.border,
            }}
          >
            <Text
              style={{
                color: selected === opt.value ? theme.colors.tint : theme.colors.text,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
