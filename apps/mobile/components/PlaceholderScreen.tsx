import React from "react";
import { EmptyState, Screen, AppHeader } from "@/components/ui";

type Props = {
  title: string;
  message?: string;
  showBack?: boolean;
  onBack?: () => void;
};

/** Lightweight placeholder for features not yet migrated to mobile. */
export function PlaceholderScreen({ title, message, showBack, onBack }: Props) {
  return (
    <Screen>
      <AppHeader title={title} onBack={showBack ? onBack : undefined} />
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
