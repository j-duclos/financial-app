import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRule,
  getRule,
  updateRule,
} from "@budget-app/api-client";
import type { RecurringRuleFrequency } from "@budget-app/shared";
import {
  formatAccountOptionLabel,
  getAccountInstitutionSubtitle,
  getEffectiveDisplayName,
} from "@budget-app/shared";
import { AppHeader, Button, ErrorState, Screen, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateRecurringRuleDependents } from "@/lib/financialQueryRefresh";
import { todayStr } from "@/lib/dates";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { useHouseholds } from "@/hooks/useHouseholds";
import { useProfile } from "@/lib/profileQuery";
import { recurringQueryKeys } from "./queryKeys";
import { DatePickerField, EndsDateField, OptionsPickerSheet, SelectField, type PickerOption } from "@/components/forms";
import { monthlyWeekdayLabel } from "./recurringDisplay";

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
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: 5, label: "Fifth" },
];

/** Prefer backend allows_transfer_destination / system_code — never English display names. */
function categoryAllowsTransferDestination(
  cat: { allows_transfer_destination?: boolean; system_code?: string | null } | null | undefined
): boolean {
  if (!cat) return false;
  if (typeof cat.allows_transfer_destination === "boolean") {
    return cat.allows_transfer_destination;
  }
  const code = cat.system_code ?? null;
  return code === "BANK_TRANSFER" || code === "CREDIT_CARD_PAYMENT";
}

function isBankTransferCategory(
  cat: { system_code?: string | null } | null | undefined
): boolean {
  return cat?.system_code === "BANK_TRANSFER";
}

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
  const amountRaw = sched?.amount ?? rule.amount;
  const absAmount = String(Math.abs(parseFloat(amountRaw) || 0) || amountRaw).replace(/^-/, "");
  return {
    name: rule.name,
    household: rule.household,
    account_id: sched?.account_id ?? rule.account?.id ?? 0,
    transfer_to_account_id: sched?.transfer_to_account_id ?? rule.transfer_to_account?.id ?? null,
    category_id: sched?.category_id ?? rule.category?.id ?? null,
    direction: (sched?.direction ?? rule.direction) as Direction,
    amount: absAmount,
    currency: sched?.currency ?? rule.currency ?? "USD",
    frequency: source.frequency,
    interval: Math.max(1, Number(source.interval) || 1),
    day_of_week: source.day_of_week ?? 0,
    day_of_month: source.day_of_month ?? 15,
    nth_week: source.nth_week ?? 1,
    start_date: (sched?.start_date ?? rule.start_date).slice(0, 10),
    end_date: (sched?.end_date ?? rule.end_date)?.slice(0, 10) ?? "",
    lifecycleStatus: !rule.active
      ? "paused"
      : rule.end_date && rule.end_date.slice(0, 10) < todayStr()
        ? "ended"
        : "running",
    notes: rule.notes ?? "",
    scheduleChangeLater: !!sched,
    changeEffectiveDate: sched?.effective_from?.slice(0, 10) ?? "",
  };
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

export function RecurringFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId) && editingId > 0;
  const [form, setForm] = useState<FormState>(() => defaultForm());
  const [error, setError] = useState<string | null>(null);
  const [accountPicker, setAccountPicker] = useState<"from" | "to" | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [frequencyPickerOpen, setFrequencyPickerOpen] = useState(false);
  const [weekdayPickerOpen, setWeekdayPickerOpen] = useState(false);
  const [nthPickerOpen, setNthPickerOpen] = useState(false);

  const profileQuery = useProfile();
  const householdsQuery = useHouseholds();
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

  const { accounts } = useAccountOptions({ householdId: householdId || null });
  // Single category fetch — filter client-side for picker type; transfer semantics use system_code.
  const { categories: allCategories } = useCategoryOptions({
    householdId: householdId || null,
    enabled: householdId > 0,
  });
  const categories = useMemo(() => {
    if (form.direction === "INCOME") {
      return allCategories.filter((c) => c.category_type === "INCOME");
    }
    if (form.direction === "EXPENSE") {
      return allCategories.filter((c) => c.category_type === "EXPENSE");
    }
    return [];
  }, [allCategories, form.direction]);

  useEffect(() => {
    if (!householdId || form.household) return;
    setForm((f) => ({ ...f, household: householdId }));
  }, [householdId, form.household]);

  useEffect(() => {
    if (ruleQuery.data) setForm(ruleToForm(ruleQuery.data));
  }, [ruleQuery.data]);

  // Auto-bind Bank Transfer system category for TRANSFER direction.
  useEffect(() => {
    if (form.direction !== "TRANSFER") return;
    const bankTransfer = allCategories.find((c) => isBankTransferCategory(c));
    if (bankTransfer && form.category_id !== bankTransfer.id) {
      setForm((f) => ({ ...f, category_id: bankTransfer.id }));
    }
  }, [form.direction, form.category_id, allCategories]);

  const selectedAccount = accounts.find((a) => a.id === form.account_id);
  const selectedTo = accounts.find((a) => a.id === form.transfer_to_account_id);
  const selectedCategory =
    categories.find((c) => c.id === form.category_id) ??
    allCategories.find((c) => c.id === form.category_id);
  const frequencyLabel = FREQUENCIES.find((f) => f.value === form.frequency)?.label ?? form.frequency;

  const accountOptions: PickerOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        id: String(a.id),
        title: getEffectiveDisplayName(a),
        subtitle: [getAccountInstitutionSubtitle(a), a.account_type].filter(Boolean).join(" · "),
        searchText: `${formatAccountOptionLabel(a)} ${a.account_type} ${getAccountInstitutionSubtitle(a)}`,
      })),
    [accounts]
  );

  const toAccountOptions = useMemo(
    () => accountOptions.filter((o) => Number(o.id) !== form.account_id),
    [accountOptions, form.account_id]
  );

  const categoryOptions: PickerOption[] = useMemo(
    () => [
      { id: "", title: "None", subtitle: "No category" },
      ...categories.map((c) => ({
        id: String(c.id),
        title: c.name,
        subtitle: c.category_type,
        searchText: c.name,
      })),
    ],
    [categories]
  );

  const showTransferDestination =
    form.direction === "TRANSFER" || categoryAllowsTransferDestination(selectedCategory);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const today = todayStr();
      const { active, end_date } = lifecycleToActive(form.lifecycleStatus, form.end_date, today);

      let categoryId = form.category_id;
      let transferTo = form.transfer_to_account_id;

      if (form.direction === "TRANSFER") {
        const bankTransfer = allCategories.find((c) => isBankTransferCategory(c));
        categoryId = bankTransfer?.id ?? categoryId;
        if (!transferTo || transferTo === form.account_id) {
          throw new Error("Choose a different destination account for the transfer.");
        }
      } else if (!showTransferDestination) {
        transferTo = null;
      } else {
        const cat = allCategories.find((c) => c.id === categoryId) ?? selectedCategory;
        const allowed = categoryAllowsTransferDestination(cat);
        if (!allowed) transferTo = null;
        if (allowed && (!transferTo || transferTo === form.account_id)) {
          throw new Error("Choose a destination account for this payment/transfer.");
        }
      }

      const cleaned = form.amount.trim().replace(/[^0-9.]/g, "");
      if (!cleaned || cleaned === ".") {
        throw new Error("Enter a valid amount.");
      }
      const parts = cleaned.split(".");
      const whole = parts[0] || "0";
      const frac = (parts[1] ?? "").slice(0, 2).padEnd(2, "0");
      const amountStr = `${whole}.${frac}`;
      if (amountStr === "0.00") {
        throw new Error("Enter a valid amount.");
      }

      const payload: Record<string, unknown> = {
        household: form.household || householdId,
        name: form.name.trim(),
        account_id: form.account_id,
        transfer_to_account_id: transferTo,
        category_id: categoryId,
        direction: form.direction,
        amount: amountStr,
        currency: form.currency,
        frequency: form.frequency,
        interval: form.interval,
        day_of_week:
          form.frequency === "WEEKLY" ||
          form.frequency === "BIWEEKLY" ||
          form.frequency === "MONTHLY_NTH_WEEKDAY"
            ? form.day_of_week
            : null,
        day_of_month: form.frequency === "MONTHLY_DAY" ? form.day_of_month : undefined,
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
    <Screen scroll={false} edges={["top", "left", "right", "bottom"]}>
      <AppHeader title={isEdit ? "Edit recurring" : "New recurring"} onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
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
            onSelect={(v) => {
              set("direction", v as Direction);
              if (v === "TRANSFER") {
                set("category_id", null);
              } else {
                set("transfer_to_account_id", null);
              }
            }}
          />

          <TextField
            label="Amount"
            value={form.amount}
            onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />

          <SelectField
            label={form.direction === "TRANSFER" ? "From account" : "Account"}
            value={selectedAccount ? getEffectiveDisplayName(selectedAccount) : null}
            onPress={() => setAccountPicker("from")}
          />

          {showTransferDestination ? (
            <SelectField
              label={form.direction === "TRANSFER" ? "To account" : "Pay to"}
              value={selectedTo ? getEffectiveDisplayName(selectedTo) : null}
              placeholder="Select destination"
              onPress={() => setAccountPicker("to")}
            />
          ) : null}

          {form.direction !== "TRANSFER" ? (
            <SelectField
              label="Category"
              value={selectedCategory?.name ?? null}
              placeholder="Select category"
              onPress={() => setCategoryPickerOpen(true)}
            />
          ) : null}

          <SelectField
            label="Frequency"
            value={frequencyLabel}
            onPress={() => setFrequencyPickerOpen(true)}
          />

          {(form.frequency === "WEEKLY" || form.frequency === "BIWEEKLY") && (
            <SelectField
              label="On"
              value={WEEKDAYS.find((d) => d.value === (form.day_of_week ?? 0))?.label ?? null}
              onPress={() => setWeekdayPickerOpen(true)}
            />
          )}

          {form.frequency === "MONTHLY_DAY" && (
            <TextField
              label="Day"
              value={String(form.day_of_month)}
              onChangeText={(v) => {
                const n = Number(v.replace(/\D/g, ""));
                if (!v) {
                  set("day_of_month", 1);
                  return;
                }
                set("day_of_month", Math.min(31, Math.max(1, n || 1)));
              }}
              keyboardType="number-pad"
            />
          )}

          {form.frequency === "MONTHLY_NTH_WEEKDAY" && (
            <>
              <SelectField
                label="Every"
                value={monthlyWeekdayLabel(form.nth_week, form.day_of_week)}
                onPress={() => setNthPickerOpen(true)}
              />
              <SelectField
                label="Weekday"
                value={WEEKDAYS.find((d) => d.value === (form.day_of_week ?? 0))?.label ?? null}
                onPress={() => setWeekdayPickerOpen(true)}
              />
            </>
          )}

          {form.frequency === "YEARLY" ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
              Repeats each year on the anniversary of the start date.
            </Text>
          ) : null}

          {form.frequency === "BIWEEKLY" ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
              Biweekly cadence is anchored from the start date.
            </Text>
          ) : null}

          <DatePickerField
            label="Starts"
            value={form.start_date}
            onChange={(iso) => set("start_date", iso)}
          />

          <EndsDateField
            value={form.end_date || null}
            onChange={(iso) => set("end_date", iso ?? "")}
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
                <DatePickerField
                  label="Effective date"
                  value={form.changeEffectiveDate || null}
                  placeholder="After today"
                  onChange={(iso) => set("changeEffectiveDate", iso)}
                />
              ) : null}
            </>
          ) : null}

          <TextField label="Notes" value={form.notes} onChangeText={(v) => set("notes", v)} multiline />

          <Button
            label={isEdit ? "Save changes" : "Create recurring"}
            loading={saveMutation.isPending}
            disabled={saveMutation.isPending}
            onPress={() => {
              setError(null);
              if (!form.name.trim() || !form.amount.trim() || !form.account_id) {
                setError("Name, amount, and account are required.");
                return;
              }
              if (form.direction === "TRANSFER" && !form.transfer_to_account_id) {
                setError("Transfer destination is required.");
                return;
              }
              saveMutation.mutate();
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <OptionsPickerSheet
        visible={accountPicker === "from"}
        title={form.direction === "TRANSFER" ? "From account" : "Account"}
        options={accountOptions}
        selectedId={form.account_id ? String(form.account_id) : null}
        searchPlaceholder="Search accounts"
        onClose={() => setAccountPicker(null)}
        onSelect={(id) => {
          const nextId = Number(id);
          setForm((prev) => ({
            ...prev,
            account_id: nextId,
            transfer_to_account_id:
              prev.transfer_to_account_id === nextId ? null : prev.transfer_to_account_id,
          }));
        }}
      />

      <OptionsPickerSheet
        visible={accountPicker === "to"}
        title={form.direction === "TRANSFER" ? "To account" : "Pay to"}
        options={toAccountOptions}
        selectedId={form.transfer_to_account_id ? String(form.transfer_to_account_id) : null}
        searchPlaceholder="Search accounts"
        onClose={() => setAccountPicker(null)}
        onSelect={(id) => set("transfer_to_account_id", Number(id))}
      />

      <OptionsPickerSheet
        visible={categoryPickerOpen}
        title="Category"
        options={categoryOptions}
        selectedId={form.category_id != null ? String(form.category_id) : ""}
        searchPlaceholder="Search categories"
        onClose={() => setCategoryPickerOpen(false)}
        onSelect={(id) => set("category_id", id ? Number(id) : null)}
      />

      <OptionsPickerSheet
        visible={frequencyPickerOpen}
        title="Frequency"
        options={FREQUENCIES.map((f) => ({ id: f.value, title: f.label }))}
        selectedId={form.frequency}
        onClose={() => setFrequencyPickerOpen(false)}
        onSelect={(id) => set("frequency", id as RecurringRuleFrequency)}
      />

      <OptionsPickerSheet
        visible={weekdayPickerOpen}
        title="Weekday"
        options={WEEKDAYS.map((d) => ({ id: String(d.value), title: d.label }))}
        selectedId={String(form.day_of_week ?? 0)}
        onClose={() => setWeekdayPickerOpen(false)}
        onSelect={(id) => set("day_of_week", Number(id))}
      />

      <OptionsPickerSheet
        visible={nthPickerOpen}
        title="Week of month"
        options={NTH.map((n) => ({ id: String(n.value), title: n.label }))}
        selectedId={String(form.nth_week ?? 1)}
        onClose={() => setNthPickerOpen(false)}
        onSelect={(id) => set("nth_week", Number(id))}
      />
    </Screen>
  );
}
