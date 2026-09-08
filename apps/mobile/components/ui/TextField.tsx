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

/**
 * Android Autofill/Gboard draws a floating toolbar over the field and steals taps.
 * Keep iOS Keychain hints; do not opt Android into Autofill from this component.
 */
export function TextField({
  label,
  error,
  style,
  importantForAutofill,
  autoComplete,
  ...rest
}: Props) {
  const theme = useTheme();
  const android = Platform.OS === "android";
  const autofillImportance = android
    ? "noExcludeDescendants"
    : (importantForAutofill ?? (autoComplete ? "yes" : "no"));

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
        showSoftInputOnFocus
        disableFullscreenUI={android}
        {...rest}
        autoComplete={android ? "off" : autoComplete}
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
            ...(android ? { includeFontPadding: false } : null),
          },
          style,
        ]}
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
