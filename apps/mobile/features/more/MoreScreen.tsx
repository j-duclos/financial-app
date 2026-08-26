import React, { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  ConfirmDialog,
  ListRow,
  Screen,
  SectionHeader,
} from "@/components/ui";
import { useAuth } from "@/features/auth";
import { useTheme } from "@/theme";

const PRIMARY_LINKS = [
  { title: "Accounts", href: "/accounts", subtitle: "Balances and account health" },
  { title: "Recurring", href: "/recurring", subtitle: "Income, bills, and transfers" },
  { title: "Goals", href: "/goals", subtitle: "Savings and debt goals" },
  { title: "Action Center", href: "/action-center", subtitle: "Recommendations and alerts" },
  { title: "Payment Planner", href: "/payment-planner", subtitle: "Credit payment strategies" },
  { title: "What-If Plan", href: "/what-if", subtitle: "Scenario comparisons" },
] as const;

const SECONDARY_LINKS = [
  { title: "Reports", href: "/reports", subtitle: "Monthly insights" },
  { title: "Automation", href: "/automation", subtitle: "Rules & recurring automation" },
  { title: "Categories", href: "/categories", subtitle: "Spending categories" },
  { title: "Reconcile", href: "/reconcile", subtitle: "Statement reconciliation" },
  { title: "Profile & Settings", href: "/profile", subtitle: "Account preferences" },
] as const;

export function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { auth, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <Screen scroll>
      <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: 4 }}>More</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
        {auth.user?.displayName ? `Signed in as ${auth.user.displayName}` : "Secondary tools"}
      </Text>

      <SectionHeader title="Money tools" />
      {PRIMARY_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Setup" />
      {SECONDARY_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <View style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.xxl }}>
        <Button label="Log out" variant="danger" onPress={() => setConfirmLogout(true)} />
      </View>

      <ConfirmDialog
        visible={confirmLogout}
        title="Log out?"
        message="You will need to sign in again to view your finances."
        confirmLabel="Log out"
        destructive
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          try {
            await logout();
            router.replace("/(auth)/login");
          } finally {
            setLoggingOut(false);
            setConfirmLogout(false);
          }
        }}
      />
    </Screen>
  );
}
