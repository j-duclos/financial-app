import React from "react";
import { EmptyState, Screen, AppHeader } from "@/components/ui";
import { useStackBack } from "@/lib/stackNavigation";

type Props = {
  title: string;
  message?: string;
  showBack?: boolean;
  onBack?: () => void;
};

/** Lightweight placeholder for features not yet migrated to mobile. */
export function PlaceholderScreen({ title, message, showBack, onBack }: Props) {
  const stackBack = useStackBack();
  return (
    <Screen>
      <AppHeader title={title} onBack={showBack ? (onBack ?? stackBack) : undefined} />
      <EmptyState
        title={`${title} coming soon`}
        message={
          message ??
          "This section will use the same Django APIs as the web app. It is intentionally not implemented in this foundation pass."
        }
      />
    </Screen>
  );
}
