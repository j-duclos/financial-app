import React, { useState } from "react";
import { Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { APP_WEB_HOST, APP_WEB_URL } from "@budget-app/shared";
import {
  Button,
  ConfirmDialog,
  ListRow,
  Screen,
  SectionHeader,
} from "@/components/ui";
import { useAuth } from "@/features/auth";
import { useReviewFeedback } from "@/features/review";
import { useTheme } from "@/theme";

/** Planning tools — Accounts lives on the bottom tab bar. */
const PLANNING_LINKS = [
  { title: "Goals", href: "/goals", subtitle: "Savings and debt goals" },
  { title: "Payment Planner", href: "/payment-planner", subtitle: "Credit payment strategies" },
  { title: "Spending Limits", href: "/spending-limits", subtitle: "Category spending targets" },
] as const;

const MONEY_LINKS = [
  { title: "Recurring", href: "/recurring", subtitle: "Income, bills, and transfers" },
  { title: "Action Center", href: "/action-center", subtitle: "Recommendations and alerts" },
] as const;

const INSIGHTS_LINKS = [
  { title: "Reports", href: "/reports", subtitle: "Monthly insights" },
] as const;

const SETUP_LINKS = [
  { title: "Automation", href: "/automation", subtitle: "Rules & recurring automation" },
  { title: "Categories", href: "/categories", subtitle: "Income and expense categories" },
  { title: "Profile & Settings", href: "/profile", subtitle: "Account preferences" },
] as const;

export function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { auth, logout } = useAuth();
  const { openFeedback } = useReviewFeedback();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <Screen scroll>
      <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: 4 }}>More</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
        {auth.user?.displayName ? `Signed in as ${auth.user.displayName}` : "Secondary tools"}
      </Text>

      <SectionHeader title="Planning" />
      {PLANNING_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Money tools" />
      {MONEY_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Insights" />
      {INSIGHTS_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Setup" />
      {SETUP_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="FlowSight" />
      <ListRow
        title="Send feedback"
        subtitle="Tell us what we can improve"
        onPress={() => openFeedback()}
        accessibilityLabel="Send feedback"
      />
      <ListRow
        title="FlowSight on the web"
        subtitle="Open full web app"
        onPress={() => void Linking.openURL(APP_WEB_URL)}
        accessibilityLabel={`FlowSight on the web, ${APP_WEB_HOST}`}
      />

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
