import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Account } from "@budget-app/shared";
import { formatCurrency, getAccountInstitutionSubtitle, getEffectiveDisplayName } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import { groupAccountsByType } from "@/lib/accountGroups";

type Props = {
  visible: boolean;
  accounts: Account[];
  selectedAccountId: number | null;
  onClose: () => void;
  onSelect: (accountId: number) => void;
};

function accountBalanceLine(account: Account): string | null {
  if (account.account_type === "CREDIT") {
    if (account.balance_owed != null) return `Owed ${formatCurrency(account.balance_owed, account.currency)}`;
    if (account.current_balance != null) return `Balance ${formatCurrency(account.current_balance, account.currency)}`;
    return null;
  }
  const balance = account.available_balance ?? account.balance;
  if (balance != null) return `Balance ${formatCurrency(balance, account.currency)}`;
  return null;
}

export function AccountSelectorSheet({
  visible,
  accounts,
  selectedAccountId,
  onClose,
  onSelect,
}: Props) {
  const theme = useTheme();
  const groups = groupAccountsByType(accounts);

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
                  const balanceLine = accountBalanceLine(account);
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
