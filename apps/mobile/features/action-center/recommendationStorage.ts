import AsyncStorage from "@react-native-async-storage/async-storage";
import { isSurvivalModeId } from "@budget-app/shared";

const DISMISS_STORAGE_KEY = "budget-app.dashboard.dismissedRecommendations";
const SNOOZE_STORAGE_KEY = "budget-app.dashboard.snoozedRecommendations";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

async function readMap(key: string): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(key: string, value: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadDismissedRecommendationIds(): Promise<Set<string>> {
  const map = await readMap(DISMISS_STORAGE_KEY);
  return new Set(Object.keys(map));
}

export async function loadSnoozedRecommendationIds(now = Date.now()): Promise<Set<string>> {
  const map = await readMap(SNOOZE_STORAGE_KEY);
  const active = new Set<string>();
  const pruned: Record<string, number> = {};
  for (const [id, until] of Object.entries(map)) {
    if (until > now) {
      active.add(id);
      pruned[id] = until;
    }
  }
  await writeMap(SNOOZE_STORAGE_KEY, pruned);
  return active;
}

export async function dismissRecommendation(id: string): Promise<void> {
  if (isSurvivalModeId(id)) return;
  const map = await readMap(DISMISS_STORAGE_KEY);
  map[id] = Date.now();
  await writeMap(DISMISS_STORAGE_KEY, map);
}

export async function snoozeRecommendation(id: string): Promise<void> {
  if (isSurvivalModeId(id)) return;
  const map = await readMap(SNOOZE_STORAGE_KEY);
  map[id] = Date.now() + SNOOZE_MS;
  await writeMap(SNOOZE_STORAGE_KEY, map);
}

export async function unsnoozeRecommendation(id: string): Promise<void> {
  const map = await readMap(SNOOZE_STORAGE_KEY);
  delete map[id];
  await writeMap(SNOOZE_STORAGE_KEY, map);
}

export async function restoreRecommendation(id: string): Promise<void> {
  const map = await readMap(DISMISS_STORAGE_KEY);
  delete map[id];
  await writeMap(DISMISS_STORAGE_KEY, map);
}

export async function snoozeResolveRisk(snoozeId: string | null | undefined): Promise<void> {
  if (snoozeId) await snoozeRecommendation(snoozeId);
}
