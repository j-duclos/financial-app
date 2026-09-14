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
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { canOfferStripePremiumPurchase } from "@/features/billing/billingProvider";
import {
  PREMIUM_DISCOVERY_SUBTITLE,
  PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE,
  PREMIUM_MONTHLY_PRICE_LABEL,
  PREMIUM_SHEET_TITLE,
} from "@/features/billing";
import { useTheme } from "@/theme";

/** Core money workflows — Automation owns recurring-rule management. */
const MONEY_LINKS = [
  { title: "Automation", href: "/automation", subtitle: "Create and manage recurring rules" },
  { title: "Action Center", href: "/action-center", subtitle: "Alerts and recommended actions" },
  { title: "Recurring", href: "/recurring", subtitle: "Upcoming recurring activity" },
] as const;

/** Planning tools — Accounts lives on the bottom tab bar. */
const PLANNING_LINKS = [
  { title: "Goals", href: "/goals", subtitle: "Savings and debt goals" },
  { title: "Payment Planner", href: "/payment-planner", subtitle: "Credit payment strategies" },
  { title: "Spending Limits", href: "/spending-limits", subtitle: "Category spending targets" },
] as const;

const INSIGHTS_SETUP_LINKS = [
  { title: "Categories", href: "/categories", subtitle: "Income and expense categories" },
  { title: "Reports", href: "/reports", subtitle: "Monthly insights" },
] as const;

const ACCOUNT_LINKS = [
  { title: "Profile & Settings", href: "/profile", subtitle: "Account preferences" },
] as const;

export function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { auth, logout } = useAuth();
  const { openFeedback } = useReviewFeedback();
  const { billing } = useBillingStatus();
  const { promptUpgrade } = usePremiumUpgrade();
  const isPremium = billing?.is_premium === true;
  const canPurchase = canOfferStripePremiumPurchase();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <Screen scroll>
      <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: 4 }}>More</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
        {auth.user?.displayName ? `Signed in as ${auth.user.displayName}` : "Secondary tools"}
      </Text>

      <SectionHeader title="Money tools" />
      {MONEY_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Planning" />
      {PLANNING_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Insights & setup" />
      {INSIGHTS_SETUP_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}

      <SectionHeader title="Account" />
      {ACCOUNT_LINKS.map((link) => (
        <ListRow
          key={link.href}
          title={link.title}
          subtitle={link.subtitle}
          onPress={() => router.push(link.href as never)}
        />
      ))}
      {!isPremium ? (
        <ListRow
          title={PREMIUM_SHEET_TITLE}
          subtitle={
            canPurchase
              ? `${PREMIUM_DISCOVERY_SUBTITLE} · ${PREMIUM_MONTHLY_PRICE_LABEL}`
              : PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE
          }
          onPress={() => promptUpgrade()}
          accessibilityLabel={
            canPurchase
              ? `${PREMIUM_SHEET_TITLE}, ${PREMIUM_DISCOVERY_SUBTITLE}, ${PREMIUM_MONTHLY_PRICE_LABEL}`
              : `${PREMIUM_SHEET_TITLE}, ${PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE}`
          }
        />
      ) : null}
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
