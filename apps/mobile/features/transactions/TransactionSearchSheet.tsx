import React from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  visible: boolean;
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
  onClear: () => void;
};

export function TransactionSearchSheet({ visible, value, onChange, onClose, onClear }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <BottomSheet
      visible={visible}
      title="Search transactions"
      onClose={onClose}
      contentStyle={{ minHeight: "40%", maxHeight: "55%" }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <TextField
          label="Payee or memo"
          value={value}
          onChangeText={onChange}
          placeholder="Search this account ledger"
          autoFocus={visible}
          returnKeyType="search"
        />
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.caption,
            marginTop: theme.spacing.sm,
          }}
        >
          Matches Recent, Pending, and Upcoming rows for the selected account.
        </Text>
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginTop: theme.spacing.lg,
            paddingBottom: Math.max(insets.bottom, theme.spacing.md),
          }}
        >
          <View style={{ flex: 1 }}>
            <Button
              label="Clear"
              variant="secondary"
              onPress={() => {
                onClear();
                onClose();
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Done" onPress={onClose} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
