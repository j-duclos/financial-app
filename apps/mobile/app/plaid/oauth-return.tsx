import { Text, View } from "react-native";
import { useTheme } from "@/theme";

/**
 * Universal Link landing for Plaid iOS OAuth.
 * Stay on this screen. Navigating away tears down the native Link session.
 */
export default function PlaidOAuthReturnScreen() {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.background,
        padding: 24,
      }}
    >
      <Text style={{ color: theme.colors.text, textAlign: "center", ...theme.typography.body }}>
        Finishing bank sign-in…
      </Text>
    </View>
  );
}
