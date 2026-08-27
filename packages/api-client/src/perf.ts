let perfLoggingEnabled = false;
let perfEnvTag = "";

/**
 * Enable [PERF] lines in the console.
 * Optional envTag (e.g. "local" | "render") prefixes as [PERF][render].
 */
export function configurePerfLogging(enabled: boolean, envTag?: string): void {
  perfLoggingEnabled = enabled;
  perfEnvTag = envTag?.trim() ?? "";
}

export function isPerfLoggingEnabled(): boolean {
  return perfLoggingEnabled;
}

export function getPerfEnvTag(): string {
  return perfEnvTag;
}

export function perfLog(message: string): void {
  if (!perfLoggingEnabled) return;
  const prefix = perfEnvTag ? `[PERF][${perfEnvTag}]` : "[PERF]";
  const line = message.startsWith("[PERF]")
    ? `${prefix}${message.slice("[PERF]".length)}`
    : `${prefix} ${message}`;
  // eslint-disable-next-line no-console
  console.log(line);
}

export function serializeQueryKey(key: readonly unknown[]): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}
