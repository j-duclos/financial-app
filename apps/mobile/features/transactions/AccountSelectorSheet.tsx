import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listAccounts } from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import { getAccountInstitutionSubtitle, getEffectiveDisplayName } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import { groupAccountsByType } from "@/lib/accountGroups";
import { accountQueryKeys } from "@/features/accounts/queryKeys";
import { formatAccountSelectorBalanceLine } from "./accountSelectorBalance";

type Props = {
  visible: boolean;
  accounts: Account[];
  selectedAccountId: number | null;
  onClose: () => void;
  onSelect: (accountId: number) => void;
};

export function AccountSelectorSheet({
  visible,
  accounts,
  selectedAccountId,
  onClose,
  onSelect,
}: Props) {
  const theme = useTheme();
  const groups = groupAccountsByType(accounts);
  const balanceListQuery = useQuery({
    queryKey: accountQueryKeys.mainList(),
    queryFn: () => listAccounts({ balance: "true", page_size: 500, active_only: true }),
    enabled: visible,
    staleTime: 30_000,
  });
  const balancesById = useMemo(() => {
    const map = new Map<number, Account>();
    for (const row of balanceListQuery.data?.results ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [balanceListQuery.data?.results]);

  return (
    <BottomSheet visible={visible} title="Select account" onClose={onClose}>
      <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.spacing.lg }}>
          {groups.map((group) => (
            <View key={group.key}>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.caption,
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {group.label}
              </Text>
              <View style={{ gap: 4 }}>
                {group.accounts.map((account) => {
                  const selected = account.id === selectedAccountId;
                  const balanceLine = formatAccountSelectorBalanceLine(balancesById.get(account.id));
                  return (
                    <Pressable
                      key={account.id}
                      onPress={() => {
                        onSelect(account.id);
                        onClose();
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{
                        paddingVertical: theme.spacing.md,
                        paddingHorizontal: theme.spacing.sm,
                        borderRadius: theme.radius.md,
                        backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
                        borderWidth: 1,
                        borderColor: selected ? theme.colors.tint : theme.colors.border,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                        {getEffectiveDisplayName(account)}
                      </Text>
                      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
                        {getAccountInstitutionSubtitle(account)}
                      </Text>
                      {balanceLine ? (
                        <Text
                          style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}
                        >
                          {balanceLine}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
