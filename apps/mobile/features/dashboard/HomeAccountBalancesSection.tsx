import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getEffectiveDisplayName, type Account } from "@budget-app/shared";
import { BalanceDisplay, CurrencyDisplay, SectionHeader, Skeleton } from "@/components/ui";
import { useTheme } from "@/theme";
import { resolveListPrimaryBalance } from "@/features/accounts/accountBalanceDisplay";

const PREVIEW_LIMIT = 4;

type Props = {
  accounts: Account[];
  loading: boolean;
  refetching?: boolean;
};

function AccountRowsSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }} testID="home-account-balances-skeleton">
      {Array.from({ length: 2 }).map((_, index) => (
        <View
          key={index}
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: theme.spacing.lg,
            gap: 8,
          }}
        >
          <Skeleton height={14} width="48%" />
          <Skeleton height={22} width="36%" />
        </View>
      ))}
    </View>
  );
}

export const HomeAccountBalancesSection = memo(function HomeAccountBalancesSection({
  accounts,
  loading,
  refetching,
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const preview = accounts.slice(0, PREVIEW_LIMIT);

  return (
    <View style={{ marginBottom: theme.spacing.lg }} testID="home-account-balances">
      <SectionHeader
        title="Accounts"
        actionLabel={accounts.length > 0 ? "View all" : undefined}
        onAction={accounts.length > 0 ? () => router.push("/(app)/(tabs)/accounts") : undefined}
      />
      {refetching ? (
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
          Updating…
        </Text>
      ) : null}
      {loading ? (
        <AccountRowsSkeleton />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {preview.map((account) => {
            const primary = resolveListPrimaryBalance(account);
            const name = getEffectiveDisplayName(account);
            if (primary.amount == null) {
              return (
                <Pressable
                  key={account.id}
                  onPress={() => router.push("/(app)/(tabs)/accounts")}
                  accessibilityRole="button"
                  accessibilityLabel={`${name} account`}
                >
                  <BalanceDisplay label={name} amount="—" subtitle={primary.label} />
                </Pressable>
              );
            }
            return (
              <Pressable
                key={account.id}
                onPress={() => router.push("/(app)/(tabs)/accounts")}
                accessibilityRole="button"
                accessibilityLabel={`${name} ${primary.label} ${primary.amount}`}
                testID={`home-account-balance-${account.id}`}
              >
                <View
                  style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: theme.spacing.lg,
                    gap: 4,
                  }}
                >
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {name}
                  </Text>
                  <CurrencyDisplay
                    amount={primary.amount}
                    style={{ ...theme.typography.title, fontSize: 22 }}
                  />
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                    {primary.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
});
