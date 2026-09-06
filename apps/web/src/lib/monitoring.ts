import * as Sentry from "@sentry/react";
import { scrubSentryEvent, type ScrubableSentryEvent } from "./sentryScrub";

let monitoringEnabled = false;

function dsn(): string {
  return (import.meta.env.VITE_SENTRY_DSN ?? "").trim();
}

export function isWebMonitoringEnabled(): boolean {
  return monitoringEnabled;
}

export function initWebMonitoring(): boolean {
  const sentryDsn = dsn();
  if (!sentryDsn) {
    monitoringEnabled = false;
    return false;
  }
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "").trim() || import.meta.env.MODE,
    release: (import.meta.env.VITE_SENTRY_RELEASE ?? "").trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as ScrubableSentryEvent) as unknown as typeof event;
    },
  });
  monitoringEnabled = true;
  return true;
}

export function setMonitoringUser(userId: number | null): void {
  if (!monitoringEnabled) return;
  Sentry.setUser(userId != null ? { id: String(userId) } : null);
}

export function captureAppException(error: unknown, extra?: Record<string, unknown>): void {
  if (!monitoringEnabled) return;
  Sentry.captureException(
    error,
    extra ? { extra: scrubSentryEvent({ extra }).extra as Record<string, unknown> } : undefined
  );
}
