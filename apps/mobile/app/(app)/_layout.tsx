import { Redirect, Stack, usePathname } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/features/auth";
import { setPendingPostLoginRedirect } from "@/lib/postLoginRedirect";
import { useTheme } from "@/theme";

export default function AppLayout() {
  const { auth } = useAuth();
  const theme = useTheme();
  const pathname = usePathname();

  if (auth.initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.tint} />
      </View>
    );
  }

  if (!auth.isAuthenticated) {
    if (pathname && pathname !== "/") {
      setPendingPostLoginRedirect(pathname);
    }
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="account/[id]" />
      <Stack.Screen name="account/new" />
      <Stack.Screen name="account/edit/[id]" />
      <Stack.Screen name="transaction/[id]" />
      <Stack.Screen name="transaction/new" />
      <Stack.Screen name="transaction/edit/[id]" />
      <Stack.Screen name="recurring" />
      <Stack.Screen name="recurring/[id]" />
      <Stack.Screen name="recurring/new" />
      <Stack.Screen name="recurring/edit/[id]" />
      <Stack.Screen name="budget/index" />
      <Stack.Screen name="budget/[targetId]" />
      <Stack.Screen name="spending-limits" />
      <Stack.Screen name="spending-limits/new" />
      <Stack.Screen name="spending-limits/edit/[id]" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="goal/[id]" />
      <Stack.Screen name="goal/new" />
      <Stack.Screen name="goal/edit/[id]" />
      <Stack.Screen name="action-center" />
      <Stack.Screen name="payment-planner" />
      <Stack.Screen name="payment-planner/plan-details" />
      <Stack.Screen name="what-if" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="reports/[type]" />
      <Stack.Screen name="reports/category/[categoryId]" />
      <Stack.Screen name="automation" />
      <Stack.Screen name="automation/[id]" />
      <Stack.Screen name="automation/new" />
      <Stack.Screen name="automation/edit/[id]" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="categories/new" />
      <Stack.Screen name="categories/edit/[id]" />
      <Stack.Screen name="reconcile" />
      <Stack.Screen name="reconcile/session/[id]" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}
