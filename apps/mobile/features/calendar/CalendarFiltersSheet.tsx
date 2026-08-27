import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { getEffectiveDisplayName } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import type { CalendarEventFilter, CalendarFlowFilter } from "./types";

type Props = {
  visible: boolean;
  onClose: () => void;
  accounts: Account[];
  accountsLoading?: boolean;
  accountsError?: boolean;
  accountId: number | "";
  onAccountChange: (id: number | "") => void;
  eventFilter: CalendarEventFilter;
  onEventFilterChange: (next: CalendarEventFilter) => void;
};

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: selected ? theme.colors.tint : theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor: selected ? theme.colors.tint : theme.colors.border,
      }}
    >
      <Text style={{ color: selected ? theme.colors.onTint : theme.colors.text, fontWeight: "600", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CalendarFiltersSheet({
  visible,
  onClose,
  accounts,
  accountsLoading = false,
  accountsError = false,
  accountId,
  onAccountChange,
  eventFilter,
  onEventFilterChange,
}: Props) {
  const theme = useTheme();
  const flowOptions: { value: CalendarFlowFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expenses" },
    { value: "transfer", label: "Transfers" },
  ];

  return (
    <BottomSheet visible={visible} title="Calendar filters" onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: theme.spacing.lg }}>
        <View>
          <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>Account</Text>
          {accountsError ? (
            <Text style={{ color: theme.colors.warning, fontSize: 13, marginBottom: 8 }}>
              Could not load accounts — calendar data is still available.
            </Text>
          ) : null}
          {accountsLoading ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: 13, marginBottom: 8 }}>
              Loading accounts…
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip label="All accounts" selected={accountId === ""} onPress={() => onAccountChange("")} />
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={getEffectiveDisplayName(account)}
                selected={accountId === account.id}
                onPress={() => onAccountChange(account.id)}
              />
            ))}
          </View>
        </View>
        <View>
          <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>Type</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {flowOptions.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={eventFilter.flow === opt.value}
                onPress={() => onEventFilterChange({ ...eventFilter, flow: opt.value })}
              />
            ))}
          </View>
        </View>
        <View>
          <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>Source</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip
              label="All events"
              selected={!eventFilter.recurringOnly}
              onPress={() => onEventFilterChange({ ...eventFilter, recurringOnly: false })}
            />
            <Chip
              label="Recurring only"
              selected={eventFilter.recurringOnly}
              onPress={() => onEventFilterChange({ ...eventFilter, recurringOnly: true })}
            />
          </View>
        </View>
        <Button label="Done" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}
