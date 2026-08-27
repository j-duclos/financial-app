import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth";
import { refetchFinancialDataOnForeground } from "@/lib/financialQueryRefresh";

const BACKGROUND_REFRESH_MS = 5 * 60_000;

/**
 * After meaningful background time, refresh stale financial summaries — not every query.
 */
export function useAppLifecycleRefresh(): void {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const lastBackgroundAt = useRef<number | null>(null);

  useEffect(() => {
    if (!auth.isAuthenticated) return;

    const onChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        lastBackgroundAt.current = Date.now();
        return;
      }
      if (next !== "active") return;

      const sinceBackground = lastBackgroundAt.current;
      lastBackgroundAt.current = null;
      if (sinceBackground == null) return;
      if (Date.now() - sinceBackground < BACKGROUND_REFRESH_MS) return;

      refetchFinancialDataOnForeground(queryClient);
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [auth.isAuthenticated, queryClient]);
}
