import React, { useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { BrandWordmark } from "@/components/brand";
import { useTheme } from "@/theme";

/**
 * Covers sensitive UI in the app switcher when the app is inactive/backgrounded.
 * Does not encrypt snapshots — reduces casual shoulder-surfing in task switcher.
 */
export function PrivacyOverlay() {
  const theme = useTheme();
  const [obscure, setObscure] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setObscure(state === "inactive" || state === "background");
    });
    return () => sub.remove();
  }, []);

  if (!obscure) return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.background, zIndex: 9999 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <BrandWordmark size="medium" />
        {Platform.OS === "ios" ? (
          <Text style={{ color: theme.colors.textMuted, marginTop: 8, ...theme.typography.caption }}>
            Financial data hidden
          </Text>
        ) : null}
      </View>
    </View>
  );
}
