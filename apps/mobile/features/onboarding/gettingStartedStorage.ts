import AsyncStorage from "@react-native-async-storage/async-storage";
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
let notifyScheduled = false;

export function educationFlagsEqual(
  a: GettingStartedEducationFlags,
  b: GettingStartedEducationFlags
): boolean {
  return (
    a.home_forecast_intro_seen === b.home_forecast_intro_seen &&
    a.first_account_success_seen === b.first_account_success_seen &&
    a.first_transaction_forecast_seen === b.first_transaction_forecast_seen &&
    a.calendar_intro_seen === b.calendar_intro_seen &&
    a.calendar_onboarding_handoff_seen === b.calendar_onboarding_handoff_seen &&
    a.getting_started_collapsed === b.getting_started_collapsed
  );
}

function scheduleEducationNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    listeners.forEach((listener) => listener());
  });
}

export function getGettingStartedEducationCache(
  userId: number
): GettingStartedEducationFlags | undefined {
  return memory.get(userId);
}

export function setGettingStartedEducationCache(
  userId: number,
  flags: GettingStartedEducationFlags
): void {
  const prev = memory.get(userId);
  memory.set(userId, flags);
  if (prev && educationFlagsEqual(prev, flags)) return;
  scheduleEducationNotify();
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
      calendar_onboarding_handoff_seen: Boolean(parsed.calendar_onboarding_handoff_seen),
      getting_started_collapsed: Boolean(parsed.getting_started_collapsed),
    };
  } catch {
    return null;
  }
}

export function serializeGettingStartedEducation(flags: GettingStartedEducationFlags): string {
  return JSON.stringify(flags);
}

/** Write empty one-time flags so Getting Started education can run again. */
export async function resetGettingStartedEducation(userId: number): Promise<void> {
  const empty = { ...EMPTY_GETTING_STARTED_EDUCATION };
  setGettingStartedEducationCache(userId, empty);
  await AsyncStorage.setItem(
    gettingStartedEducationStorageKey(userId),
    serializeGettingStartedEducation(empty)
  );
}

export function mergeGettingStartedEducation(
  current: GettingStartedEducationFlags,
  patch: Partial<GettingStartedEducationFlags>
): GettingStartedEducationFlags {
  return { ...current, ...patch };
}

export { EMPTY_GETTING_STARTED_EDUCATION };
