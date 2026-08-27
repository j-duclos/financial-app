import React from "react";
import { Pressable, Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  DEFAULT_TARGET_UTILIZATION_PERCENT,
  formatCurrency,
  getAccountInstitutionSubtitle,
  getEffectiveDisplayName,
  type Account,
} from "@budget-app/shared";
import { StatusChip, UtilizationDisplay } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  account: Account;
  onPress: () => void;
};

export const AccountRow = React.memo(function AccountRow({ account, onPress }: Props) {
  const theme = useTheme();
  const isCredit = account.account_type === "CREDIT";
  const targetUtil = parseFloat(
    account.target_utilization_percent ?? String(DEFAULT_TARGET_UTILIZATION_PERCENT)
  );
  const util = account.utilization_percent != null ? parseFloat(account.utilization_percent) : NaN;
  const utilAboveTarget = Number.isFinite(util) && util > targetUtil;
  const health = account.health_status ?? account.risk_status;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={getEffectiveDisplayName(account)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        paddingVertical: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.colors.surfaceMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FontAwesome
            name={isCredit ? "credit-card" : account.account_type === "SAVINGS" ? "bank" : "money"}
            size={16}
            color={theme.colors.textSecondary}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
            {getEffectiveDisplayName(account)}
          </Text>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            {getAccountInstitutionSubtitle(account)}
          </Text>
          {health ? (
            <StatusChip
              label={health}
              tone={health === "healthy" ? "positive" : health === "watch" ? "warning" : "critical"}
            />
          ) : null}
          {isCredit && account.utilization_percent != null ? (
            <View style={{ marginTop: 6 }}>
              <UtilizationDisplay
                value={account.utilization_percent}
                warnAt={targetUtil}
                criticalAt={targetUtil * 2}
                label={`Utilization (target ${Math.round(targetUtil)}%)`}
              />
              {utilAboveTarget ? (
                <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginTop: 4 }}>
                  Above your {Math.round(targetUtil)}% target
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {isCredit ? (
            <>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Owed</Text>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                {account.balance_owed != null ? formatCurrency(account.balance_owed, account.currency) : "—"}
              </Text>
              {account.available_credit != null ? (
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  Avail {formatCurrency(account.available_credit, account.currency)}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Balance</Text>
              <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                {account.available_balance != null
                  ? formatCurrency(account.available_balance, account.currency)
                  : account.balance != null
                    ? formatCurrency(account.balance, account.currency)
                    : "—"}
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
});
