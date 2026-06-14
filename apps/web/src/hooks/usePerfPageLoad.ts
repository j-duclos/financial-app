import { useEffect, useRef } from "react";
import { isPerfLoggingEnabled, perfLog } from "@budget-app/api-client";

/** Log when a page's primary data has finished loading (browser console [PERF]). */
export function usePerfPageLoad(
  label: string,
  isReady: boolean,
  extra?: Record<string, string | number | boolean | null | undefined>
): void {
  const mountAt = useRef(performance.now());
  const logged = useRef(false);

  useEffect(() => {
    mountAt.current = performance.now();
    logged.current = false;
  }, [label]);

  useEffect(() => {
    if (!isReady) {
      logged.current = false;
      return;
    }
    if (logged.current || !isPerfLoggingEnabled()) return;
    logged.current = true;
    const parts = [
      `[PERF] page_ready ${label} elapsed_ms=${Math.round(performance.now() - mountAt.current)}`,
    ];
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (value == null || value === "") continue;
        parts.push(`${key}=${value}`);
      }
    }
    perfLog(parts.join(" "));
  }, [isReady, label, extra]);
}
