import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  markStartupEvent,
  requestStartupTraceFinish,
  startStartupTrace,
} from "./startupTrace";

const RESUME_TRACE_MIN_BACKGROUND_MS = 1_000;

/**
 * Starts a cold-launch trace on first mount and a resume trace after background.
 */
export function useStartupTraceLifecycle(): void {
  const lastBackgroundAt = useRef<number | null>(null);
  const startedCold = useRef(false);

  useEffect(() => {
    if (!startedCold.current) {
      startedCold.current = true;
      startStartupTrace({ type: "cold_launch" });
      markStartupEvent("app_started");
      if (AppState.currentState === "active") {
        markStartupEvent("app_became_active");
      }
    }

    const onChange = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        lastBackgroundAt.current = Date.now();
        return;
      }
      if (next !== "active") return;

      const since =
        lastBackgroundAt.current != null ? Date.now() - lastBackgroundAt.current : null;
      lastBackgroundAt.current = null;

      if (since != null && since >= RESUME_TRACE_MIN_BACKGROUND_MS) {
        startStartupTrace({ type: "foreground_resume", timeSinceBackgroundMs: since });
        markStartupEvent("app_started");
        markStartupEvent("app_became_active", { time_since_background_ms: since });
        markStartupEvent("first_screen_ready");
        queueMicrotask(() => requestStartupTraceFinish());
        return;
      }

      markStartupEvent("app_became_active", {
        time_since_background_ms: since ?? undefined,
      });
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);
}
