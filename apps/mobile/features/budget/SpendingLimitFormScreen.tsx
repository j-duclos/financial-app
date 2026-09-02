import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSpendingTarget,
  deleteSpendingTarget,
  getSpendingTarget,
  suggestSpendingTargetType,
  updateSpendingTarget,
} from "@budget-app/api-client";
import type { SpendingTargetPeriod, SpendingTargetType } from "@budget-app/shared";
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ErrorState,
  Screen,
  SkeletonBlock,
  TextField,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateSpendingTargetDependents } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { budgetQueryKeys } from "./queryKeys";

const PERIODS: { value: SpendingTargetPeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function SpendingLimitFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const isEdit = editingId != null && Number.isInteger(editingId) && editingId > 0;

  const { householdId } = useDefaultHouseholdId();
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [targetAmount, setTargetAmount] = useState("");
  const [period, setPeriod] = useState<SpendingTargetPeriod>("monthly");
  const [targetType, setTargetType] = useState<SpendingTargetType>("variable");
  const [warningThreshold, setWarningThreshold] = useState("");
  const [notes, setNotes] = useState("");
  const [suggestReason, setSuggestReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const categoriesQuery = useCategoryOptions({
    householdId,
    type: "EXPENSE",
  });

  const editingQuery = useQuery({
    queryKey: ["spending-target-edit", editingId],
    queryFn: () => getSpendingTarget(editingId!),
    enabled: isEdit && householdId != null,
    initialData: () => {
      if (!editingId) return undefined;
      const caches = queryClient.getQueriesData<{ results?: { id: number }[] }>({
        queryKey: ["spending-targets"],
      });
      for (const [, data] of caches) {
        const hit = data?.results?.find((t) => t.id === editingId);
        if (hit) return hit as import("@budget-app/shared").SpendingTarget;
      }
      return undefined;
    },
  });

  useEffect(() => {
    const initial = editingQuery.data;
    if (!initial) return;
    setCategoryId(initial.category.id);
    setTargetAmount(initial.target_amount);
    setPeriod(initial.period);
    setTargetType(initial.target_type ?? "variable");
    setWarningThreshold(initial.warning_threshold_percent);
    setNotes(initial.notes ?? "");
  }, [editingQuery.data]);

  const suggestionQuery = useQuery({
    queryKey: budgetQueryKeys.suggestType(typeof categoryId === "number" ? categoryId : 0),
    queryFn: () => suggestSpendingTargetType(categoryId as number),
    enabled: !isEdit && typeof categoryId === "number",
  });

  useEffect(() => {
    if (isEdit || typeof categoryId !== "number" || !suggestionQuery.data) return;
    setTargetType(suggestionQuery.data.target_type);
    setSuggestReason(suggestionQuery.data.reason);
  }, [isEdit, categoryId, suggestionQuery.data]);

  const expenseCategories = useMemo(() => {
    const seen = new Set<string>();
    return (categoriesQuery.categories ?? [])
      .filter((c) => c.category_type === "EXPENSE" && !c.is_archived)
      .filter((c) => {
        const key = c.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categoriesQuery.categories]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!householdId) throw new Error("No household selected.");
      const body: Parameters<typeof createSpendingTarget>[0] = {
        household: householdId,
        category: categoryId as number,
        target_amount: targetAmount.trim(),
        period,
        target_type: targetType,
        notes: notes.trim() || undefined,
      };
      const threshold = warningThreshold.trim();
      if (threshold) {
        body.warning_threshold_percent = threshold;
      }
      if (isEdit) return updateSpendingTarget(editingId!, body);
      return createSpendingTarget(body);
    },
    onSuccess: () => {
      invalidateSpendingTargetDependents(queryClient);
      router.back();
    },
    onError: (err: Error) => setError(err.message || "Could not save spending limit"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSpendingTarget(editingId!),
    onSuccess: () => {
      invalidateSpendingTargetDependents(queryClient);
      router.back();
    },
    onError: (err: Error) => setError(err.message || "Could not delete spending limit"),
  });

  if (isEdit && editingQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Edit limit" onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (isEdit && editingQuery.isError) {
    return (
      <Screen>
        <ErrorState message={describeApiError(editingQuery.error)} onRetry={() => editingQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader title={isEdit ? "Edit spending limit" : "Add spending limit"} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 32 }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
        {suggestReason ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{suggestReason}</Text>
        ) : null}

        <ChipSection
          label="Category"
          options={expenseCategories.map((c) => ({ value: String(c.id), label: c.name }))}
          selected={String(categoryId || "")}
          onSelect={(v) => setCategoryId(Number(v))}
          disabled={isEdit}
        />

        <TextField
          label="Limit amount"
          value={targetAmount}
          onChangeText={setTargetAmount}
          keyboardType="decimal-pad"
        />

        <ChipSection
          label="Period"
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          selected={period}
          onSelect={(v) => setPeriod(v as SpendingTargetPeriod)}
        />

        <ChipSection
          label="Spending type"
          options={[
            { value: "variable", label: "Variable" },
            { value: "fixed", label: "Fixed / scheduled" },
          ]}
          selected={targetType}
          onSelect={(v) => setTargetType(v as SpendingTargetType)}
        />

        <TextField
          label="Warning threshold %"
          value={warningThreshold}
          onChangeText={setWarningThreshold}
          keyboardType="number-pad"
          placeholder="Leave blank for server default"
        />

        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />

        <Button
          label={isEdit ? "Save changes" : "Create limit"}
          loading={saveMutation.isPending}
          onPress={() => {
            setError(null);
            if (!categoryId || !targetAmount.trim()) {
              setError("Category and limit amount are required.");
              return;
            }
            saveMutation.mutate();
          }}
        />
        {isEdit ? (
          <Button label="Delete limit" variant="danger" onPress={() => setConfirmDelete(true)} />
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete spending limit?"
        message="Future budget tracking for this limit stops. Historical transactions are unchanged."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

function ChipSection({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            disabled={disabled}
            onPress={() => onSelect(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === opt.value, disabled: !!disabled }}
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
