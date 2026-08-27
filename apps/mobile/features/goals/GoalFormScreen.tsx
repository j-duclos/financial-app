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
import {
  buildBucketFundingPayload,
  buildGoalBucketPayload,
  emptyGoalForm,
  type GoalFormValues,
} from "./form";
import { goalDetailPath, goalsListPath } from "./navigation";
import { goalsQueryKeys, invalidateGoalsQueries } from "./queryKeys";

const ACTIVE_GOAL_STATUSES: FinancialGoalStatus[] = ["active", "paused"];

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

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <Text
        style={{
          color: theme.colors.textMuted,
          ...theme.typography.label,
          marginBottom: theme.spacing.sm,
          textTransform: "uppercase",
        }}
      >
        {title}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>{children}</View>
    </View>
  );
}

function ChipSelect({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: { value: string; label: string; disabled?: boolean }[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginBottom: 6 }}>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {options.map((opt) => {
            const active = selected === opt.value;
            return (
              <Pressable
                key={opt.value}
                disabled={disabled || opt.disabled}
                onPress={() => onSelect(opt.value)}
                style={{
                  opacity: opt.disabled ? 0.4 : 1,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: theme.radius.full,
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
      </ScrollView>
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
        await configureBucketFunding(saved.id, buildBucketFundingPayload(values.funding, values.monthly_contribution));
      }
      return saved;
    },
    onSuccess: (saved) => {
      invalidateGoalsQueries(queryClient);
      router.replace(goalDetailPath(saved.id));
    },
    onError: (err) => setSubmitError(describeApiError(err)),
  });

  const onSubmit = () => {
    setSubmitError(null);
    const nextErrors = validateGoalForm(form);
    if (goalFormHasErrors(nextErrors)) {
      setErrors(nextErrors as Record<string, string>);
      return;
    }
    setErrors({});
    saveMu.mutate({ ...form, auto_fund_enabled: form.funding.enabled });
  };

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
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <FormSection title="Goal">
          <TextField
            label="Goal name"
            value={form.name}
            onChangeText={(name) => setForm((f) => ({ ...f, name }))}
            error={errors.name}
          />
          <ChipSelect
            label="Goal type"
            selected={form.goal_type}
            disabled={isEdit}
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
          {isEdit ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              Goal type cannot be changed after creation.
            </Text>
          ) : null}
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
          <TextField
            label="Target date (YYYY-MM-DD, optional)"
            value={form.target_date}
            onChangeText={(target_date) => setForm((f) => ({ ...f, target_date }))}
            error={errors.target_date}
            placeholder="2026-12-01"
          />
          <TextField
            label="Description (optional)"
            value={form.description}
            onChangeText={(description) => setForm((f) => ({ ...f, description }))}
          />
        </FormSection>

        <FormSection title="Funding">
          {isDebt ? (
            <ChipSelect
              label="Linked credit/loan account"
              selected={form.linked_credit_account ? String(form.linked_credit_account) : ""}
              onSelect={(value) => {
                const accountId = value ? Number(value) : "";
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
              }}
              options={[
                { value: "", label: "Select account" },
                ...debtAccounts.map((a) => {
                  const usedBy = accountUsedByAnotherGoal(a.id, existingGoals, editing?.id);
                  const owed = creditBalanceOwed(a);
                  return {
                    value: String(a.id),
                    label: `${getEffectiveDisplayName(a)}${owed != null ? ` · ${formatCurrency(String(owed))}` : ""}`,
                    disabled: usedBy != null,
                  };
                }),
              ]}
            />
          ) : (
            <ChipSelect
              label="Linked account"
              selected={form.linked_account ? String(form.linked_account) : ""}
              onSelect={(value) =>
                setForm((f) => ({ ...f, linked_account: value ? Number(value) : "" }))
              }
              options={[
                { value: "", label: "Select account" },
                ...savingsAccounts.map((a) => ({
                  value: String(a.id),
                  label: getEffectiveDisplayName(a),
                  disabled: accountUsedByAnotherGoal(a.id, existingGoals, editing?.id) != null,
                })),
              ]}
            />
          )}
          {errors.linked_account ? (
            <Text style={{ color: theme.colors.critical, fontSize: 12 }}>{errors.linked_account}</Text>
          ) : null}
          {errors.linked_credit_account ? (
            <Text style={{ color: theme.colors.critical, fontSize: 12 }}>{errors.linked_credit_account}</Text>
          ) : null}

          <TextField
            label="Planned monthly contribution"
            value={form.monthly_contribution}
            onChangeText={(monthly_contribution) => setForm((f) => ({ ...f, monthly_contribution }))}
            keyboardType="decimal-pad"
            error={errors.monthly_contribution}
          />

          {!isDebt ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: theme.colors.text, ...theme.typography.body }}>Auto-transfer on payday</Text>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    Schedule transfers from paycheck rules
                  </Text>
                </View>
                <Switch
                  value={form.funding.enabled}
                  onValueChange={(enabled) =>
                    setForm((f) => ({ ...f, funding: { ...f.funding, enabled } }))
                  }
                />
              </View>
              {form.funding.enabled ? (
                <>
                  <ChipSelect
                    label="Paycheck rule"
                    selected={form.funding.incomeRuleId ? String(form.funding.incomeRuleId) : ""}
                    onSelect={(value) =>
                      setForm((f) => ({
                        ...f,
                        funding: { ...f.funding, incomeRuleId: value ? Number(value) : "" },
                      }))
                    }
                    options={[
                      { value: "", label: "Select paycheck" },
                      ...incomeRules.map((r) => ({
                        value: String(r.id),
                        label: `${r.name} (${formatCurrency(String(r.amount))})`,
                      })),
                    ]}
                  />
                  <ChipSelect
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
                </>
              ) : null}
              {errors.funding ? (
                <Text style={{ color: theme.colors.critical, fontSize: 12 }}>{errors.funding}</Text>
              ) : null}
            </>
          ) : null}
        </FormSection>

        <FormSection title="Behavior">
          <ChipSelect
            label="Priority"
            selected={String(form.priority)}
            onSelect={(value) => setForm((f) => ({ ...f, priority: Number(value) }))}
            options={[
              { value: "1", label: "Highest" },
              { value: "2", label: "High" },
              { value: "3", label: "Medium" },
              { value: "4", label: "Low" },
              { value: "5", label: "Lowest" },
            ]}
          />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.text, flex: 1 }}>Reduce safe-to-spend on linked account</Text>
            <Switch
              value={form.include_in_safe_to_spend}
              onValueChange={(include_in_safe_to_spend) =>
                setForm((f) => ({ ...f, include_in_safe_to_spend }))
              }
            />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.text, flex: 1 }}>Include in forecast</Text>
            <Switch
              value={form.forecast_enabled}
              onValueChange={(forecast_enabled) => setForm((f) => ({ ...f, forecast_enabled }))}
            />
          </View>
          <TextField
            label="Notes (optional)"
            value={form.notes}
            onChangeText={(notes) => setForm((f) => ({ ...f, notes }))}
            multiline
          />
        </FormSection>

        {submitError ? (
          <Text style={{ color: theme.colors.critical, marginBottom: theme.spacing.sm }}>{submitError}</Text>
        ) : null}

        <Button
          label={saveMu.isPending ? "Saving…" : isEdit ? "Save changes" : "Create goal"}
          loading={saveMu.isPending}
          onPress={onSubmit}
        />
      </ScrollView>
    </Screen>
  );
}
