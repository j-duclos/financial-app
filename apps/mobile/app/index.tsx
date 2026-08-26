import { useEffect } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/features/auth";
import { useTheme } from "@/theme";

export default function Index() {
  const { auth } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    if (auth.initializing) return;
    if (auth.isAuthenticated) {
      router.replace("/(app)/(tabs)");
    } else {
      router.replace("/(auth)/login");
    }
  }, [auth.initializing, auth.isAuthenticated, router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.background,
      }}
      accessibilityLabel="Loading"
    >
      <ActivityIndicator size="large" color={theme.colors.tint} />
    </View>
  );
}
