import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from "@budget-app/api-client";
import type { CategoryType } from "@budget-app/shared";
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
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { OptionsPickerSheet, SelectField } from "@/components/forms";
import {
  categoryTypeLabel,
  isDefaultCategory,
  parentOptionsForType,
  validateCategoryName,
} from "./categoryList";
import { categoriesListPath } from "./navigation";
import { categoriesQueryKeys, invalidateAfterCategoryMutation } from "./queryKeys";

const TYPE_OPTIONS: { value: CategoryType; label: string }[] = [
  { value: "EXPENSE", label: "Expense" },
  { value: "INCOME", label: "Income" },
];

function TypeSelector({
  value,
  onChange,
  disabled,
}: {
  value: CategoryType;
  onChange: (next: CategoryType) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        Type
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {TYPE_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              disabled={disabled}
              onPress={() => onChange(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: active ? theme.colors.tint : theme.colors.border,
                backgroundColor: active ? theme.colors.tintMuted : theme.colors.surface,
                alignItems: "center",
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <Text
                style={{
                  color: active ? theme.colors.tint : theme.colors.text,
                  fontWeight: active ? "700" : "500",
                  fontSize: 14,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {disabled ? (
        <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginTop: 6 }}>
          Type is set when the category is created and cannot be changed here.
        </Text>
      ) : null}
    </View>
  );
}

export function CategoryFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { householdId } = useDefaultHouseholdId();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId != null && Number.isInteger(editId) && editId > 0;

  const [name, setName] = useState("");
  const [categoryType, setCategoryType] = useState<CategoryType>("EXPENSE");
  const [parentId, setParentId] = useState<number | null>(null);
  const [isArchived, setIsArchived] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: categoriesQueryKeys.detail(editId ?? 0),
    queryFn: () => getCategory(editId as number),
    enabled: isEdit,
  });

  const managedQuery = useQuery({
    queryKey: categoriesQueryKeys.managed(householdId),
    queryFn: () =>
      listCategories({
        household: householdId ?? undefined,
        include_archived: true,
        page_size: 500,
      }),
    enabled: householdId != null,
    staleTime: 60_000,
  });

  useEffect(() => {
    const cat = detailQuery.data;
    if (!cat) return;
    setName(cat.name);
    setCategoryType(cat.category_type);
    setParentId(cat.parent);
    setIsArchived(cat.is_archived);
  }, [detailQuery.data]);

  const parents = useMemo(
    () => parentOptionsForType(managedQuery.data?.results ?? [], categoryType, editId),
    [managedQuery.data?.results, categoryType, editId]
  );

  const parentName = parents.find((p) => p.id === parentId)?.name
    ?? (managedQuery.data?.results ?? []).find((c) => c.id === parentId)?.name
    ?? null;

  const isSystem = detailQuery.data ? isDefaultCategory(detailQuery.data) : false;

  const invalidate = () => invalidateAfterCategoryMutation(queryClient);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      const err = validateCategoryName(trimmed);
      if (err) {
        setNameError(err);
        throw new Error(err);
      }
      setNameError(null);
      if (isEdit && editId != null) {
        return updateCategory(editId, {
          name: trimmed,
          parent: parentId,
          is_archived: isArchived,
        });
      }
      if (householdId == null) throw new Error("No household found on your profile.");
      return createCategory({
        household: householdId,
        name: trimmed,
        category_type: categoryType,
        parent: parentId ?? undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      router.replace(categoriesListPath());
    },
    onError: (err) => {
      setSubmitError(describeApiError(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (editId == null) throw new Error("Missing category");
      return deleteCategory(editId);
    },
    onSuccess: () => {
      invalidate();
      setDeleteOpen(false);
      router.replace(categoriesListPath());
    },
    onError: (err) => {
      setDeleteOpen(false);
      Alert.alert("Delete failed", describeApiError(err));
    },
  });

  if (isEdit && detailQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Edit category" showBack onBack={() => router.back()} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (isEdit && detailQuery.isError) {
    return (
      <Screen scroll>
        <AppHeader title="Edit category" showBack onBack={() => router.back()} />
        <ErrorState
          message={describeApiError(detailQuery.error)}
          onRetry={() => detailQuery.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader
        title={isEdit ? "Edit category" : "New category"}
        showBack
        onBack={() => router.back()}
      />

      <TextField
        label="Name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (nameError) setNameError(null);
          if (submitError) setSubmitError(null);
        }}
        autoCapitalize="words"
        error={nameError ?? undefined}
      />

      <TypeSelector
        value={categoryType}
        onChange={(next) => {
          setCategoryType(next);
          setParentId(null);
        }}
        disabled={isEdit}
      />

      {parents.length > 0 || parentId != null ? (
        <SelectField
          label="Parent (optional)"
          value={parentName}
          placeholder="None"
          onPress={() => setParentPickerOpen(true)}
          style={{ marginBottom: theme.spacing.md }}
        />
      ) : null}

      {isEdit ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: theme.spacing.md,
            minHeight: theme.touchTarget,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: theme.colors.text, ...theme.typography.body }}>Archived</Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
              Archived categories stay on historical transactions but leave new-selection pickers.
            </Text>
          </View>
          <Switch
            value={isArchived}
            onValueChange={setIsArchived}
            accessibilityLabel="Archived"
          />
        </View>
      ) : null}

      {isSystem ? (
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          Default category — editing is allowed; historical links stay intact when archived.
        </Text>
      ) : null}

      {submitError ? (
        <Text style={{ color: theme.colors.critical, marginBottom: 12 }}>{submitError}</Text>
      ) : null}

      <View style={{ gap: 8, marginTop: 8 }}>
        <Button
          label={isEdit ? "Save changes" : "Create category"}
          onPress={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
        />

        {isEdit ? (
          <Button label="Delete" variant="danger" onPress={() => setDeleteOpen(true)} />
        ) : null}
      </View>

      <OptionsPickerSheet
        visible={parentPickerOpen}
        title="Parent category"
        selectedId={parentId != null ? String(parentId) : "none"}
        options={[
          { id: "none", title: "None" },
          ...parents.map((p) => ({
            id: String(p.id),
            title: p.name,
            subtitle: categoryTypeLabel(p.category_type),
          })),
        ]}
        searchPlaceholder="Search parents"
        onClose={() => setParentPickerOpen(false)}
        onSelect={(id) => {
          setParentId(id === "none" ? null : Number(id));
          setParentPickerOpen(false);
        }}
      />

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete category?"
        message="If it has transactions or budgets, it will be archived instead."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Screen>
  );
}
