import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bucketPriorityToNumber,
  formatCurrency,
  getEffectiveDisplayName,
  goalFundingFormFromAllocation,
  goalFormHasErrors,
  GOAL_TYPE_OPTIONS,
  isDebtGoalType,
  validateGoalForm,
  type Account,
  type FinancialGoal,
  type FinancialGoalStatus,
} from "@budget-app/shared";
import {
  configureBucketFunding,
  createBucket,
  getBucketsOverview,
  listAccounts,
  listRuleAllocations,
  listRules,
  updateBucket,
} from "@budget-app/api-client";
import {
  AppHeader,
  Button,
  ErrorState,
  Screen,
  SkeletonBlock,
  TextField,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { DatePickerField } from "@/features/recurring/DatePickerField";
import { OptionsPickerSheet, type PickerOption } from "@/features/recurring/OptionsPickerSheet";
import {
  buildBucketFundingPayload,
  buildGoalBucketPayload,
  emptyGoalForm,
  type GoalFormValues,
} from "./form";
import { goalDetailPath, goalsListPath } from "./navigation";
import { goalsQueryKeys, invalidateGoalFundingQueries, invalidateGoalMetadataQueries } from "./queryKeys";
import { invalidateForecastQueries } from "@/lib/financialQueryRefresh";

const ACTIVE_GOAL_STATUSES: FinancialGoalStatus[] = ["active", "paused"];

const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "High" },
  { value: 3, label: "Normal" },
  { value: 5, label: "Low" },
];

function creditBalanceOwed(account: Account): number | null {
  if (account.balance_owed != null && account.balance_owed !== "") {
    const n = parseFloat(account.balance_owed);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (account.current_balance != null && account.current_balance !== "") {
    const n = parseFloat(account.current_balance);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function accountUsedByAnotherGoal(
  accountId: number,
  goals: FinancialGoal[],
  editingGoalId?: number
): string | null {
  for (const g of goals) {
    if (editingGoalId != null && g.id === editingGoalId) continue;
    if (!g.status || !ACTIVE_GOAL_STATUSES.includes(g.status)) continue;
    const linked = g.linked_account ?? g.linked_credit_account;
    if (linked === accountId) return g.name;
  }
  return null;
}

function SelectRow({
  label,
  value,
  placeholder = "Select",
  onPress,
  error,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? placeholder}`}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: error ? theme.colors.critical : theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text
          style={{ flex: 1, color: value ? theme.colors.text : theme.colors.textMuted }}
          numberOfLines={1}
        >
          {value ?? placeholder}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>
      {error ? (
        <Text style={{ color: theme.colors.critical, fontSize: 12, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}

function SwitchRow({
  label,
  help,
  value,
  onValueChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: theme.colors.text, ...theme.typography.body }}>{label}</Text>
        {help ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
            {help}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function ChipRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? theme.colors.tint : theme.colors.border,
                backgroundColor: active ? theme.colors.tintMuted : theme.colors.surface,
              }}
            >
              <Text style={{ color: active ? theme.colors.tint : theme.colors.text, fontSize: 13 }}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function GoalFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId) && editingId > 0;

  const { householdId, isReady } = useDefaultHouseholdId();
  const [form, setForm] = useState<GoalFormValues>(emptyGoalForm);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [picker, setPicker] = useState<"type" | "account" | "paycheck" | "priority" | null>(null);

  const overviewQuery = useQuery({
    queryKey: goalsQueryKeys.overview(householdId),
    queryFn: () => getBucketsOverview({ household: householdId! }),
    enabled: isReady && householdId != null,
  });

  const accountsQuery = useQuery({
    queryKey: goalsQueryKeys.formAccounts(),
    queryFn: () => listAccounts({ balance: "true", page_size: 500, active_only: true }),
    enabled: householdId != null,
  });

  const rulesQuery = useQuery({
    queryKey: goalsQueryKeys.formRules(),
    queryFn: () => listRules(),
    enabled: householdId != null && !isDebtGoalType(form.goal_type),
  });

  const allocationQuery = useQuery({
    queryKey: goalsQueryKeys.formAllocation(editingId ?? 0),
    queryFn: () => listRuleAllocations({ bucket: editingId! }),
    enabled: isEdit && editingId != null,
  });

  const editing = useMemo(
    () => overviewQuery.data?.goals.find((g) => g.id === editingId) ?? null,
    [overviewQuery.data, editingId]
  );

  const accounts = accountsQuery.data?.results ?? [];
  const existingGoals = overviewQuery.data?.goals ?? [];
  const incomeRules = (rulesQuery.data?.results ?? []).filter(
    (r) => r.active !== false && r.direction === "INCOME"
  );
  const isDebt = isDebtGoalType(form.goal_type);

  const savingsAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (a.status === "active" || !a.status) &&
          !a.is_hidden &&
          (a.account_type === "CHECKING" || a.account_type === "SAVINGS" || a.account_type === "CASH")
      ),
    [accounts]
  );

  const debtAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (a.status === "active" || !a.status) &&
          !a.is_hidden &&
          (a.account_type === "CREDIT" || a.role === "loan")
      ),
    [accounts]
  );

  useEffect(() => {
    if (!isEdit || !editing) return;
    const allocation = allocationQuery.data?.results?.[0];
    const funding = goalFundingFormFromAllocation(
      editing.auto_fund_enabled ?? false,
      allocation,
      editing.monthly_contribution ?? editing.monthly_target
    );
    setForm({
      name: editing.name,
      description: editing.description ?? "",
      goal_type: editing.goal_type,
      target_amount: editing.target_amount,
      starting_debt_amount: editing.starting_debt_amount ?? "",
      target_date: editing.target_date ?? "",
      linked_account: editing.linked_account ?? "",
      linked_credit_account: editing.linked_credit_account ?? editing.linked_account ?? "",
      monthly_contribution: editing.monthly_contribution ?? editing.monthly_target ?? "0",
      priority:
        typeof editing.priority === "number"
          ? editing.priority
          : bucketPriorityToNumber(editing.priority),
      include_in_safe_to_spend: editing.include_in_safe_to_spend ?? true,
      forecast_enabled: editing.forecast_enabled ?? true,
      auto_fund_enabled: editing.auto_fund_enabled ?? false,
      notes: editing.notes ?? "",
      funding,
    });
  }, [isEdit, editing, allocationQuery.data]);

  const saveMu = useMutation({
    mutationFn: async (values: GoalFormValues) => {
      const body = buildGoalBucketPayload(householdId!, values);
      const saved = isEdit
        ? await updateBucket(editingId!, body)
        : await createBucket(body);
      if (!isDebtGoalType(values.goal_type)) {
        await configureBucketFunding(
          saved.id,
          buildBucketFundingPayload(values.funding, values.monthly_contribution)
        );
      }
      return saved;
    },
    onSuccess: (saved) => {
      if (isDebtGoalType(form.goal_type)) {
        invalidateGoalMetadataQueries(queryClient);
        invalidateForecastQueries(queryClient);
      } else {
        invalidateGoalFundingQueries(queryClient);
      }
      router.replace(goalDetailPath(saved.id));
    },
    onError: (err) => setSubmitError(describeApiError(err)),
  });

  const onSubmit = () => {
    if (saveMu.isPending) return;
    setSubmitError(null);
    const nextErrors = validateGoalForm(form);
    if (goalFormHasErrors(nextErrors)) {
      setErrors(nextErrors as Record<string, string>);
      return;
    }
    setErrors({});
    saveMu.mutate({ ...form, auto_fund_enabled: form.funding.enabled });
  };

  const goalTypeLabel =
    GOAL_TYPE_OPTIONS.find((o) => o.value === form.goal_type)?.label ?? form.goal_type;

  const linkedAccountLabel = useMemo(() => {
    if (isDebt) {
      if (!form.linked_credit_account) return null;
      const account = debtAccounts.find((a) => a.id === form.linked_credit_account);
      if (!account) return `Account #${form.linked_credit_account}`;
      const owed = creditBalanceOwed(account);
      return `${getEffectiveDisplayName(account)}${owed != null ? ` · ${formatCurrency(String(owed))}` : ""}`;
    }
    if (!form.linked_account) return null;
    const account = savingsAccounts.find((a) => a.id === form.linked_account);
    return account ? getEffectiveDisplayName(account) : `Account #${form.linked_account}`;
  }, [isDebt, form.linked_credit_account, form.linked_account, debtAccounts, savingsAccounts]);

  const paycheckLabel = useMemo(() => {
    if (!form.funding.incomeRuleId) return null;
    const rule = incomeRules.find((r) => r.id === form.funding.incomeRuleId);
    return rule
      ? `${rule.name} (${formatCurrency(String(rule.amount))})`
      : `Rule #${form.funding.incomeRuleId}`;
  }, [form.funding.incomeRuleId, incomeRules]);

  const priorityLabel =
    PRIORITY_OPTIONS.find((o) => o.value === form.priority)?.label ??
    (form.priority <= 2 ? "High" : form.priority >= 4 ? "Low" : "Normal");

  const accountOptions: PickerOption[] = useMemo(() => {
    const list = isDebt ? debtAccounts : savingsAccounts;
    return list
      .filter((a) => accountUsedByAnotherGoal(a.id, existingGoals, editing?.id) == null)
      .map((a) => {
        const owed = isDebt ? creditBalanceOwed(a) : null;
        return {
          id: String(a.id),
          title: getEffectiveDisplayName(a),
          subtitle: owed != null ? formatCurrency(String(owed)) : undefined,
          searchText: `${getEffectiveDisplayName(a)} ${a.account_type ?? ""}`,
        };
      });
  }, [isDebt, debtAccounts, savingsAccounts, existingGoals, editing?.id]);

  const typeOptions: PickerOption[] = GOAL_TYPE_OPTIONS.map((o) => ({
    id: o.value,
    title: o.label,
  }));

  const paycheckOptions: PickerOption[] = incomeRules.map((r) => ({
    id: String(r.id),
    title: r.name,
    subtitle: formatCurrency(String(r.amount)),
  }));

  const priorityPickerOptions: PickerOption[] = PRIORITY_OPTIONS.map((o) => ({
    id: String(o.value),
    title: o.label,
  }));

  if (!isReady || (isEdit && overviewQuery.isLoading && !editing)) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={8} />
      </Screen>
    );
  }

  if (isEdit && overviewQuery.isSuccess && !editing) {
    return (
      <Screen scroll={false}>
        <ErrorState message="Goal not found." onRetry={() => router.push(goalsListPath())} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader
        title={isEdit ? "Edit goal" : "Create goal"}
        onBack={() => (isEdit && editingId ? router.push(goalDetailPath(editingId)) : router.back())}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl, gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <TextField
          label="Goal name"
          value={form.name}
          onChangeText={(name) => setForm((f) => ({ ...f, name }))}
          error={errors.name}
        />

        {isEdit ? (
          <View>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
              Goal type
            </Text>
            <Text style={{ color: theme.colors.text }}>{goalTypeLabel}</Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
              Goal type cannot be changed after creation.
            </Text>
          </View>
        ) : GOAL_TYPE_OPTIONS.length <= 4 ? (
          <ChipRow
            label="Goal type"
            selected={form.goal_type}
            onSelect={(goal_type) =>
              setForm((f) => ({
                ...f,
                goal_type: goal_type as GoalFormValues["goal_type"],
                linked_account: "",
                linked_credit_account: "",
              }))
            }
            options={GOAL_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        ) : (
          <SelectRow
            label="Goal type"
            value={goalTypeLabel}
            onPress={() => setPicker("type")}
          />
        )}

        <TextField
          label={isDebt ? "Payoff target" : "Target amount"}
          value={form.target_amount}
          onChangeText={(target_amount) => setForm((f) => ({ ...f, target_amount }))}
          keyboardType="decimal-pad"
          error={errors.target_amount}
        />

        {isDebt ? (
          <TextField
            label="Starting debt amount"
            value={form.starting_debt_amount}
            onChangeText={(starting_debt_amount) => setForm((f) => ({ ...f, starting_debt_amount }))}
            keyboardType="decimal-pad"
          />
        ) : null}

        <DatePickerField
          label="Target date (optional)"
          value={form.target_date || null}
          placeholder="Select target date"
          onChange={(target_date) => setForm((f) => ({ ...f, target_date }))}
        />
        {errors.target_date ? (
          <Text style={{ color: theme.colors.critical, fontSize: 12 }}>{errors.target_date}</Text>
        ) : null}

        <SelectRow
          label="Linked account"
          value={linkedAccountLabel}
          placeholder="Select account"
          onPress={() => setPicker("account")}
          error={errors.linked_account ?? errors.linked_credit_account}
        />

        <TextField
          label="Planned monthly contribution"
          value={form.monthly_contribution}
          onChangeText={(monthly_contribution) => setForm((f) => ({ ...f, monthly_contribution }))}
          keyboardType="decimal-pad"
          error={errors.monthly_contribution}
        />

        <Pressable
          onPress={() => setAdvancedOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={advancedOpen ? "Hide advanced options" : "Advanced options"}
          style={{ paddingVertical: 8 }}
        >
          <Text style={{ color: theme.colors.tint, fontWeight: "700" }}>
            {advancedOpen ? "Hide advanced options" : "Advanced options ›"}
          </Text>
        </Pressable>

        {advancedOpen ? (
          <View style={{ gap: theme.spacing.md }}>
            <SelectRow
              label="Priority"
              value={priorityLabel}
              onPress={() => setPicker("priority")}
            />

            {!isDebt ? (
              <>
                <SwitchRow
                  label="Auto-fund on payday"
                  help="Move money from a paycheck rule into this goal"
                  value={form.funding.enabled}
                  onValueChange={(enabled) =>
                    setForm((f) => ({ ...f, funding: { ...f.funding, enabled } }))
                  }
                />
                {form.funding.enabled ? (
                  <>
                    <SelectRow
                      label="Paycheck rule"
                      value={paycheckLabel}
                      placeholder="Select paycheck"
                      onPress={() => setPicker("paycheck")}
                    />
                    <ChipRow
                      label="Amount mode"
                      selected={form.funding.amountMode}
                      onSelect={(amountMode) =>
                        setForm((f) => ({
                          ...f,
                          funding: { ...f.funding, amountMode: amountMode as "fixed" | "percent" },
                        }))
                      }
                      options={[
                        { value: "fixed", label: "Fixed amount" },
                        { value: "percent", label: "Percent of paycheck" },
                      ]}
                    />
                    {form.funding.amountMode === "fixed" ? (
                      <TextField
                        label="Amount per paycheck"
                        value={form.funding.fixedAmount}
                        onChangeText={(fixedAmount) =>
                          setForm((f) => ({ ...f, funding: { ...f.funding, fixedAmount } }))
                        }
                        keyboardType="decimal-pad"
                      />
                    ) : (
                      <TextField
                        label="Percent of paycheck"
                        value={form.funding.percent}
                        onChangeText={(percent) =>
                          setForm((f) => ({ ...f, funding: { ...f.funding, percent } }))
                        }
                        keyboardType="decimal-pad"
                      />
                    )}
                    {errors.funding ? (
                      <Text style={{ color: theme.colors.critical, fontSize: 12 }}>
                        {errors.funding}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            <SwitchRow
              label="Reserve contributions from safe-to-spend"
              help="Keep this goal's planned contributions out of money available to spend"
              value={form.include_in_safe_to_spend}
              onValueChange={(include_in_safe_to_spend) =>
                setForm((f) => ({ ...f, include_in_safe_to_spend }))
              }
            />

            <SwitchRow
              label="Include in forecast"
              help="Show this goal in cash-flow and balance projections"
              value={form.forecast_enabled}
              onValueChange={(forecast_enabled) => setForm((f) => ({ ...f, forecast_enabled }))}
            />

            <TextField
              label="Notes (optional)"
              value={form.notes}
              onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
              multiline
            />
          </View>
        ) : null}

        {submitError ? (
          <Text style={{ color: theme.colors.critical }}>{submitError}</Text>
        ) : null}

        <Button
          label={saveMu.isPending ? "Saving…" : isEdit ? "Save changes" : "Create goal"}
          loading={saveMu.isPending}
          disabled={saveMu.isPending}
          onPress={onSubmit}
        />
      </ScrollView>

      <OptionsPickerSheet
        visible={picker === "type"}
        title="Goal type"
        options={typeOptions}
        selectedId={form.goal_type}
        onClose={() => setPicker(null)}
        onSelect={(id) =>
          setForm((f) => ({
            ...f,
            goal_type: id as GoalFormValues["goal_type"],
            linked_account: "",
            linked_credit_account: "",
          }))
        }
      />

      <OptionsPickerSheet
        visible={picker === "account"}
        title="Linked account"
        options={accountOptions}
        selectedId={
          isDebt
            ? form.linked_credit_account
              ? String(form.linked_credit_account)
              : null
            : form.linked_account
              ? String(form.linked_account)
              : null
        }
        searchPlaceholder="Search accounts"
        emptyMessage="No eligible accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          const accountId = Number(id);
          if (isDebt) {
            const account = debtAccounts.find((a) => a.id === accountId);
            const owed = account ? creditBalanceOwed(account) : null;
            const owedStr = owed != null ? owed.toFixed(2) : "";
            setForm((f) => ({
              ...f,
              linked_credit_account: accountId,
              starting_debt_amount: owedStr || f.starting_debt_amount,
              target_amount:
                owedStr && (!f.target_amount.trim() || parseFloat(f.target_amount) === 0)
                  ? owedStr
                  : f.target_amount,
            }));
            return;
          }
          setForm((f) => ({ ...f, linked_account: accountId }));
        }}
      />

      <OptionsPickerSheet
        visible={picker === "paycheck"}
        title="Paycheck rule"
        options={paycheckOptions}
        selectedId={form.funding.incomeRuleId ? String(form.funding.incomeRuleId) : null}
        searchPlaceholder="Search paycheck rules"
        emptyMessage="No income rules found"
        onClose={() => setPicker(null)}
        onSelect={(id) =>
          setForm((f) => ({
            ...f,
            funding: { ...f.funding, incomeRuleId: Number(id) },
          }))
        }
      />

      <OptionsPickerSheet
        visible={picker === "priority"}
        title="Priority"
        options={priorityPickerOptions}
        selectedId={String(
          form.priority <= 2 ? 1 : form.priority >= 4 ? 5 : 3
        )}
        onClose={() => setPicker(null)}
        onSelect={(id) => setForm((f) => ({ ...f, priority: Number(id) }))}
      />
    </Screen>
  );
}
