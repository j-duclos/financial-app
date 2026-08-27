import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listCategories } from "@budget-app/api-client";
import type { Category } from "@budget-app/shared";
import {
  AppHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { CategoryRow } from "./CategoryRow";
import {
  filterCategoriesForManagement,
  groupCategoriesByType,
} from "./categoryList";
import { categoryCreatePath, categoryEditPath } from "./navigation";
import { categoriesQueryKeys } from "./queryKeys";

type ListItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "row"; key: string; category: Category };

export function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { householdId } = useDefaultHouseholdId();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const categoriesQuery = useQuery({
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

  const listItems = useMemo((): ListItem[] => {
    const filtered = filterCategoriesForManagement(categoriesQuery.data?.results ?? [], {
      search,
      showArchived,
    });
    const { expense, income } = groupCategoriesByType(filtered);
    const items: ListItem[] = [];
    if (expense.length > 0) {
      items.push({ kind: "header", key: "header-expense", title: "Expense" });
      for (const category of expense) {
        items.push({ kind: "row", key: `cat-${category.id}`, category });
      }
    }
    if (income.length > 0) {
      items.push({ kind: "header", key: "header-income", title: "Income" });
      for (const category of income) {
        items.push({ kind: "row", key: `cat-${category.id}`, category });
      }
    }
    return items;
  }, [categoriesQuery.data?.results, search, showArchived]);

  const rawCount = categoriesQuery.data?.results?.length ?? 0;
  const isLoading = categoriesQuery.isLoading;
  const isError = categoriesQuery.isError;
  const isFetching = categoriesQuery.isFetching;
  const hasNoMatches = !isLoading && !isError && listItems.length === 0;

  return (
    <Screen scroll={false} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <AppHeader
          title="Categories"
          showBack
          right={
            <IconButton
              name="plus"
              accessibilityLabel="New category"
              onPress={() => router.push(categoryCreatePath())}
            />
          }
        />

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search categories"
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search categories"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceMuted,
            marginBottom: 8,
            fontSize: 16,
          }}
        />

        <Pressable
          onPress={() => setShowArchived((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: showArchived }}
          accessibilityLabel="Show archived"
          style={{
            alignSelf: "flex-start",
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: showArchived ? theme.colors.tint : theme.colors.border,
            backgroundColor: showArchived ? theme.colors.tintMuted : "transparent",
            marginBottom: 8,
          }}
        >
          <Text
            style={{
              color: showArchived ? theme.colors.tint : theme.colors.textSecondary,
              fontWeight: showArchived ? "700" : "500",
              fontSize: 12,
            }}
          >
            Show archived
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={{ padding: theme.spacing.lg, gap: 8 }}>
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={3} />
        </View>
      ) : isError ? (
        <ErrorState
          message={describeApiError(categoriesQuery.error)}
          onRetry={() => categoriesQuery.refetch()}
        />
      ) : hasNoMatches ? (
        <EmptyState
          title={rawCount === 0 ? "No categories yet" : "No matching categories"}
          message={
            rawCount === 0
              ? "Create categories to organize transactions and spending."
              : showArchived
                ? "Try a different search."
                : "Try a different search, or show archived categories."
          }
          actionLabel={rawCount === 0 ? "New category" : undefined}
          onAction={rawCount === 0 ? () => router.push(categoryCreatePath()) : undefined}
        />
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingTop: theme.spacing.md,
                    paddingBottom: theme.spacing.xs,
                    backgroundColor: theme.colors.background,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.textMuted,
                      fontSize: 12,
                      fontWeight: "700",
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                    }}
                  >
                    {item.title}
                  </Text>
                </View>
              );
            }
            return (
              <CategoryRow
                category={item.category}
                onPress={() => router.push(categoryEditPath(item.category.id))}
              />
            );
          }}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => void categoriesQuery.refetch()}
            />
          }
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Screen>
  );
}
