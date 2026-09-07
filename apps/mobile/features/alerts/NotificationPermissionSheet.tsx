import React from "react";
import { Text, View } from "react-native";
import { NOTIFICATION_PERMISSION_COPY } from "@budget-app/shared";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";

export function NotificationPermissionSheet({
  visible,
  onEnable,
  onNotNow,
}: {
  visible: boolean;
  onEnable: () => void;
  onNotNow: () => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} title={NOTIFICATION_PERMISSION_COPY.title} onClose={onNotNow}>
      <View style={{ gap: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>
          {NOTIFICATION_PERMISSION_COPY.body}
        </Text>
        <Button label={NOTIFICATION_PERMISSION_COPY.enable} onPress={onEnable} />
        <Button label={NOTIFICATION_PERMISSION_COPY.notNow} variant="ghost" onPress={onNotNow} />
      </View>
    </BottomSheet>
  );
}
