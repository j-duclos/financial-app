import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/theme";

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export function TextField({ label, error, style, importantForAutofill, ...rest }: Props) {
  const theme = useTheme();
  const autofillImportance =
    importantForAutofill ?? (rest.autoComplete ? "yes" : "no");
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.label,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textMuted}
        underlineColorAndroid="transparent"
        textAlignVertical="center"
        importantForAutofill={autofillImportance}
        style={[
          {
            minHeight: theme.touchTarget,
            borderWidth: 1,
            borderColor: error ? theme.colors.critical : theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            fontSize: 16,
            ...(Platform.OS === "android" ? { includeFontPadding: false } : null),
          },
          style,
        ]}
        {...rest}
      />
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

const styles = StyleSheet.create({});
