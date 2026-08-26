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
  updateRule,
} from "@budget-app/api-client";
import type { RecurringRuleFrequency } from "@budget-app/shared";
import { formatAccountOptionLabel } from "@budget-app/shared";
import { AppHeader, Button, ErrorState, Screen, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateRecurringRuleDependents } from "@/lib/financialQueryRefresh";
import { todayStr } from "@/lib/dates";
import { accountLifecycleStatus } from "@/lib/accountGroups";
import { recurringQueryKeys } from "./queryKeys";

type Direction = "INCOME" | "EXPENSE" | "TRANSFER";
type LifecycleStatus = "running" | "paused" | "ended";

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
  lifecycleStatus: LifecycleStatus;
  notes: string;
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
    scheduleChangeLater: false,
    changeEffectiveDate: "",
  };
}

function lifecycleToActive(status: LifecycleStatus, endDate: string, today: string) {
  if (status === "running") {
    return { active: true, end_date: endDate && endDate >= today ? endDate : null };
  }
  if (status === "paused") {
    return { active: false, end_date: endDate || null };
  }
  const endedOn = endDate && endDate <= today ? endDate : today;
  return { active: false, end_date: endedOn };
}

function ruleToForm(rule: Awaited<ReturnType<typeof getRule>>): FormState {
  const sched = rule.scheduled_change;
  const source = sched ?? rule;
  return {
    name: rule.name,
    household: rule.household,
    account_id: sched?.account_id ?? rule.account?.id ?? 0,
    transfer_to_account_id: sched?.transfer_to_account_id ?? rule.transfer_to_account?.id ?? null,
    category_id: sched?.category_id ?? rule.category?.id ?? null,
    direction: (sched?.direction ?? rule.direction) as Direction,
    amount: sched?.amount ?? rule.amount,
    currency: sched?.currency ?? rule.currency ?? "USD",
    frequency: source.frequency,
    interval: Math.max(1, Number(source.interval) || 1),
    day_of_week: source.day_of_week ?? 0,
    day_of_month: source.day_of_month ?? 15,
    nth_week: source.nth_week ?? 1,
    start_date: (sched?.start_date ?? rule.start_date).slice(0, 10),
    end_date: (sched?.end_date ?? rule.end_date)?.slice(0, 10) ?? "",
    lifecycleStatus: !rule.active ? "paused" : rule.end_date && rule.end_date.slice(0, 10) < todayStr() ? "ended" : "running",
    notes: rule.notes ?? "",
    scheduleChangeLater: !!sched,
    changeEffectiveDate: sched?.effective_from?.slice(0, 10) ?? "",
  };
}

export function RecurringFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId) && editingId > 0;
  const [form, setForm] = useState<FormState>(() => defaultForm());
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => getProfile() });
  const householdsQuery = useQuery({ queryKey: ["households"], queryFn: () => listHouseholds() });
  const ruleQuery = useQuery({
    queryKey: recurringQueryKeys.detail(editingId ?? 0),
    queryFn: () => getRule(editingId!),
    enabled: isEdit,
  });

  const householdId =
    form.household ||
    profileQuery.data?.default_household ||
    householdsQuery.data?.[0]?.id ||
    0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", "recurring-form", householdId],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", "recurring-form", householdId],
    queryFn: () => listCategories({ household: householdId, page_size: 500 }),
    enabled: householdId > 0,
  });

  const accounts = useMemo(
    () =>
      (accountsQuery.data?.results ?? []).filter(
        (a) => accountLifecycleStatus(a) === "active" && a.household?.id === householdId
      ),
    [accountsQuery.data?.results, householdId]
  );

  const categories = categoriesQuery.data?.results ?? [];

  useEffect(() => {
    if (!householdId || form.household) return;
    setForm((f) => ({ ...f, household: householdId }));
  }, [householdId, form.household]);

  useEffect(() => {
    if (ruleQuery.data) setForm(ruleToForm(ruleQuery.data));
  }, [ruleQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const selectedCat = categories.find((c) => c.id === form.category_id);
      const catName = selectedCat?.name ?? "";
      const transferAllowed = catName === "Credit Card Payment" || catName === "Bank Transfer";
      const today = todayStr();
      const { active, end_date } = lifecycleToActive(form.lifecycleStatus, form.end_date, today);

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
      };

      if (isEdit && form.scheduleChangeLater) {
        const eff = form.changeEffectiveDate.slice(0, 10);
        if (!eff || eff <= today) {
          throw new Error("Choose an effective date after today to schedule a later change.");
        }
        payload.change_effective_date = eff;
      }

      if (isEdit) {
        return updateRule(editingId!, payload);
      }
      return createRule(payload as Parameters<typeof createRule>[0]);
    },
    onSuccess: () => {
      invalidateRecurringRuleDependents(queryClient);
      router.back();
    },
    onError: (err: Error) => setError(err.message || "Could not save recurring rule"),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (isEdit && ruleQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Edit recurring" onBack={() => router.back()} />
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

  return (
    <Screen scroll={false}>
      <AppHeader title={isEdit ? "Edit recurring" : "New recurring"} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}

        <TextField label="Name" value={form.name} onChangeText={(v) => set("name", v)} />

        <ChipRow
          label="Type"
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "INCOME", label: "Income" },
            { value: "TRANSFER", label: "Transfer" },
          ]}
          selected={form.direction}
          onSelect={(v) => set("direction", v as Direction)}
        />

        <TextField label="Amount" value={form.amount} onChangeText={(v) => set("amount", v)} keyboardType="decimal-pad" />

        <ChipRow
          label="Account"
          options={accounts.map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
          selected={String(form.account_id || "")}
          onSelect={(v) => set("account_id", Number(v))}
        />

        {form.direction === "TRANSFER" ? (
          <ChipRow
            label="Transfer to"
            options={accounts
              .filter((a) => a.id !== form.account_id)
              .map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
            selected={String(form.transfer_to_account_id ?? "")}
            onSelect={(v) => set("transfer_to_account_id", Number(v))}
          />
        ) : (
          <ChipRow
            label="Category"
            options={[
              { value: "", label: "None" },
              ...categories.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            selected={String(form.category_id ?? "")}
            onSelect={(v) => set("category_id", v ? Number(v) : null)}
          />
        )}

        <ChipRow
          label="Frequency"
          options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
          selected={form.frequency}
          onSelect={(v) => set("frequency", v as RecurringRuleFrequency)}
        />

        {(form.frequency === "WEEKLY" || form.frequency === "BIWEEKLY") && (
          <ChipRow
            label="Day of week"
            options={WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label }))}
            selected={String(form.day_of_week ?? 0)}
            onSelect={(v) => set("day_of_week", Number(v))}
          />
        )}

        {form.frequency === "MONTHLY_DAY" && (
          <TextField
            label="Day of month (1–31)"
            value={String(form.day_of_month)}
            onChangeText={(v) => set("day_of_month", Math.min(31, Math.max(1, Number(v) || 1)))}
            keyboardType="number-pad"
          />
        )}

        {form.frequency === "MONTHLY_NTH_WEEKDAY" && (
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
        )}

        <TextField label="Start date (YYYY-MM-DD)" value={form.start_date} onChangeText={(v) => set("start_date", v)} />
        <TextField
          label="End date (optional)"
          value={form.end_date}
          onChangeText={(v) => set("end_date", v)}
          placeholder="Leave blank for ongoing"
        />

        <ChipRow
          label="Status"
          options={[
            { value: "running", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "ended", label: "Ended" },
          ]}
          selected={form.lifecycleStatus}
          onSelect={(v) => set("lifecycleStatus", v as LifecycleStatus)}
        />

        {isEdit ? (
          <>
            <ChipRow
              label="Apply changes"
              options={[
                { value: "now", label: "Update rule now" },
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

        <TextField label="Notes" value={form.notes} onChangeText={(v) => set("notes", v)} multiline />

        <Button
          label={isEdit ? "Save changes" : "Create recurring"}
          loading={saveMutation.isPending}
          onPress={() => {
            setError(null);
            if (!form.name.trim() || !form.amount.trim() || !form.account_id) {
              setError("Name, amount, and account are required.");
              return;
            }
            saveMutation.mutate();
          }}
        />
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
