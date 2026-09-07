import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
import { OptionsPickerSheet, SelectField } from "@/components/forms";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { invalidateSpendingTargetDependents } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { budgetQueryKeys } from "./queryKeys";
import {
  SPENDING_LIMIT_PERIODS,
  SPENDING_TYPE_OPTIONS,
  normalizeLimitAmountInput,
  spendingLimitCategoryPickerOptions,
  validateSpendingLimitAmount,
  validateSpendingLimitCategory,
} from "./spendingLimitForm";

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
  const [fieldErrors, setFieldErrors] = useState<{ category?: string; amount?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

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

  const categoryOptions = useMemo(
    () => spendingLimitCategoryPickerOptions(categoriesQuery.categories ?? []),
    [categoriesQuery.categories]
  );

  const selectedCategoryName = useMemo(() => {
    if (typeof categoryId !== "number") return null;
    return (
      categoryOptions.find((c) => c.id === String(categoryId))?.title ??
      editingQuery.data?.category?.name ??
      null
    );
  }, [categoryId, categoryOptions, editingQuery.data?.category?.name]);

  const selectedTypeHelper =
    SPENDING_TYPE_OPTIONS.find((opt) => opt.value === targetType)?.helper ?? null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!householdId) throw new Error("No household selected.");
      if (typeof categoryId !== "number") throw new Error("Select a category.");
      const payload = {
        target_amount: targetAmount.trim(),
        period,
        target_type: targetType,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(warningThreshold.trim() ? { warning_threshold_percent: warningThreshold.trim() } : {}),
      };
      if (isEdit) return updateSpendingTarget(editingId!, payload);
      return createSpendingTarget({
        household: householdId,
        category: categoryId,
        ...payload,
      } as Parameters<typeof createSpendingTarget>[0]);
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

  const onSave = () => {
    setError(null);
    const nextErrors = {
      category: validateSpendingLimitCategory(categoryId) ?? undefined,
      amount: validateSpendingLimitAmount(targetAmount) ?? undefined,
    };
    setFieldErrors(nextErrors);
    if (nextErrors.category || nextErrors.amount) return;
    saveMutation.mutate();
  };

  if (isEdit && editingQuery.isLoading) {
    return (
      <Screen>
        <AppHeader title="Edit spending limit" onBack={() => router.back()} />
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

        <View>
          <SelectField
            label="Category"
            value={selectedCategoryName}
            placeholder="Select category"
            onPress={() => setCategoryPickerOpen(true)}
            disabled={isEdit}
            error={fieldErrors.category}
          />
          {isEdit ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
              Category cannot be changed after creating a limit.
            </Text>
          ) : null}
        </View>

        <AffixedField
          label="Limit amount"
          prefix="$"
          value={targetAmount}
          onChangeText={(v) => {
            setTargetAmount(normalizeLimitAmountInput(v));
            if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          error={fieldErrors.amount}
          accessibilityLabel="Limit amount"
        />

        <ChipSection
          label="Period"
          options={SPENDING_LIMIT_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          selected={period}
          onSelect={(v) => setPeriod(v as SpendingTargetPeriod)}
        />

        <View>
          <ChipSection
            label="Spending type"
            options={SPENDING_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            selected={targetType}
            onSelect={(v) => setTargetType(v as SpendingTargetType)}
          />
          {selectedTypeHelper ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
              {selectedTypeHelper}
            </Text>
          ) : null}
          {suggestReason ? (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
              {suggestReason}
            </Text>
          ) : null}
        </View>

        <View>
          <AffixedField
            label="Alert me at"
            suffix="%"
            value={warningThreshold}
            onChangeText={setWarningThreshold}
            keyboardType="number-pad"
            placeholder="Leave blank for server default"
            accessibilityLabel="Alert me at"
          />
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
            Show a warning when spending reaches this percentage of the limit.
          </Text>
        </View>

        <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" />

        <Button
          label={isEdit ? "Save changes" : "Create limit"}
          loading={saveMutation.isPending}
          onPress={onSave}
        />

        {isEdit ? (
          <View
            style={{
              marginTop: theme.spacing.xl,
              paddingTop: theme.spacing.lg,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                color: theme.colors.critical,
                fontWeight: "600",
                marginBottom: theme.spacing.sm,
              }}
            >
              Danger zone
            </Text>
            <Button label="Delete limit" variant="danger" onPress={() => setConfirmDelete(true)} />
          </View>
        ) : null}
      </ScrollView>

      <OptionsPickerSheet
        visible={categoryPickerOpen}
        title="Category"
        options={categoryOptions}
        selectedId={typeof categoryId === "number" ? String(categoryId) : null}
        searchPlaceholder="Search categories"
        emptyMessage="No matching categories"
        onClose={() => setCategoryPickerOpen(false)}
        onSelect={(id) => {
          setCategoryId(Number(id));
          setFieldErrors((prev) => ({ ...prev, category: undefined }));
        }}
      />

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

function AffixedField({
  label,
  prefix,
  suffix,
  value,
  onChangeText,
  keyboardType,
  placeholder,
  error,
  accessibilityLabel,
}: {
  label: string;
  prefix?: string;
  suffix?: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType: "decimal-pad" | "number-pad";
  placeholder?: string;
  error?: string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: theme.spacing.xs }}>
        {label}
      </Text>
      <View
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: error ? theme.colors.critical : theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {prefix ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 16, marginRight: 6 }}>{prefix}</Text>
        ) : null}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          style={{ flex: 1, color: theme.colors.text, fontSize: 16, paddingVertical: 10 }}
        />
        {suffix ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 16, marginLeft: 6 }}>{suffix}</Text>
        ) : null}
      </View>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.critical, ...theme.typography.caption, marginTop: 4 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ChipSection({
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
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${label}: ${opt.label}`}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                minHeight: theme.touchTarget,
                justifyContent: "center",
                borderRadius: 999,
                backgroundColor: isSelected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.tint : theme.colors.border,
              }}
            >
              <Text
                style={{
                  color: isSelected ? theme.colors.tint : theme.colors.text,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
