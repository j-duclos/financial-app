let perfLoggingEnabled = false;

/** Enable [PERF] lines in the browser console (or any JS runtime with console). */
export function configurePerfLogging(enabled: boolean): void {
  perfLoggingEnabled = enabled;
}

export function isPerfLoggingEnabled(): boolean {
  return perfLoggingEnabled;
}

export function perfLog(message: string): void {
  if (!perfLoggingEnabled) return;
  // eslint-disable-next-line no-console
  console.log(message);
}

export function serializeQueryKey(key: readonly unknown[]): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}
