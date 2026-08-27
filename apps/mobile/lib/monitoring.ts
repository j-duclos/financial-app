/**
 * Crash/error monitoring integration point.
 *
 * Production beta: set EXPO_PUBLIC_SENTRY_DSN in EAS secrets to enable Sentry.
 * Until then, errors are console-only in development and silently dropped in production.
 *
 * Do NOT attach tokens, refresh tokens, or full API response bodies.
 */
import { getAppEnvironment } from "@/constants/env";
import { getAppVersionLabel, getSentryDsn } from "@/constants/appInfo";

let initialized = false;

export function initMonitoring(): void {
  if (initialized) return;
  initialized = true;

  const dsn = getSentryDsn();
  if (!dsn) {
    if (__DEV__) {
      console.info("[monitoring] Sentry DSN not configured — crash reporting disabled");
    }
    return;
  }

  // Lazy Sentry wiring: add `@sentry/react-native` and uncomment when DSN is provisioned.
  // import * as Sentry from '@sentry/react-native';
  // Sentry.init({
  //   dsn,
  //   environment: getAppEnvironment(),
  //   release: getAppVersionLabel(),
  //   beforeSend(event) {
  //     return scrubSensitiveMonitoringEvent(event);
  //   },
  // });

  if (__DEV__) {
    console.info(`[monitoring] Sentry DSN present (${getAppEnvironment()}) — native SDK install pending`);
  }
}

export function captureError(error: unknown, context?: Record<string, string>): void {
  if (__DEV__) {
    console.warn("[monitoring] captureError", context ?? {}, error);
    return;
  }

  const dsn = getSentryDsn();
  if (!dsn) return;

  // Sentry.captureException(error, { extra: context });
}

export function scrubSensitiveMonitoringEvent<T extends { request?: { headers?: Record<string, string> } }>(
  event: T
): T | null {
  if (event.request?.headers) {
    delete event.request.headers.Authorization;
    delete event.request.headers.authorization;
  }
  return event;
}
