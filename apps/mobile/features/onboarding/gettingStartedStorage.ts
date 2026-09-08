import {
  EMPTY_GETTING_STARTED_EDUCATION,
  type GettingStartedEducationFlags,
} from "@budget-app/shared";

export const GETTING_STARTED_EDUCATION_STORAGE_PREFIX = "getting-started-education:";

export function gettingStartedEducationStorageKey(userId: number): string {
  return `${GETTING_STARTED_EDUCATION_STORAGE_PREFIX}${userId}`;
}

const memory = new Map<number, GettingStartedEducationFlags>();
const listeners = new Set<() => void>();

export function getGettingStartedEducationCache(
  userId: number
): GettingStartedEducationFlags | undefined {
  return memory.get(userId);
}

export function setGettingStartedEducationCache(
  userId: number,
  flags: GettingStartedEducationFlags
): void {
  memory.set(userId, flags);
  listeners.forEach((listener) => listener());
}

export function subscribeGettingStartedEducation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseGettingStartedEducation(
  raw: string | null
): GettingStartedEducationFlags | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GettingStartedEducationFlags>;
    if (parsed == null || typeof parsed !== "object") return null;
    return {
      home_forecast_intro_seen: Boolean(parsed.home_forecast_intro_seen),
      first_account_success_seen: Boolean(parsed.first_account_success_seen),
      first_transaction_forecast_seen: Boolean(parsed.first_transaction_forecast_seen),
      calendar_intro_seen: Boolean(parsed.calendar_intro_seen),
      getting_started_collapsed: Boolean(parsed.getting_started_collapsed),
    };
  } catch {
    return null;
  }
}

export function serializeGettingStartedEducation(flags: GettingStartedEducationFlags): string {
  return JSON.stringify(flags);
}

export function mergeGettingStartedEducation(
  current: GettingStartedEducationFlags,
  patch: Partial<GettingStartedEducationFlags>
): GettingStartedEducationFlags {
  return { ...current, ...patch };
}

export { EMPTY_GETTING_STARTED_EDUCATION };
