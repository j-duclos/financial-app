import { chunkCoversMonth, type CalendarChunkWindow } from "./calendarChunks";

/** Delay before idle-loading the next large-range Calendar chunk. */
export const LARGE_RANGE_IDLE_CHUNK_MS = 800;

export function shouldEagerFetchAllChunks(windowCount: number): boolean {
  return windowCount <= 1;
}

/** Idle-preload only the immediate next chunk after the first useful months. */
export function shouldIdlePreloadNextChunk(loadCount: number, windowCount: number): boolean {
  if (windowCount <= 1) return false;
  return loadCount === 1;
}

export function nextIdleLoadCount(loadCount: number, windowCount: number): number {
  if (windowCount <= 1) return windowCount;
  return Math.min(windowCount, loadCount + 1);
}

export function loadCountForVisibleMonth(
  windows: CalendarChunkWindow[],
  year: number,
  month: number,
  currentLoadCount: number
): number {
  const index = windows.findIndex((window) => chunkCoversMonth(window, year, month));
  if (index < 0) return currentLoadCount;
  if (index < currentLoadCount) return currentLoadCount;
  if (index === currentLoadCount) return Math.min(windows.length, currentLoadCount + 1);
  return currentLoadCount;
}

export function countDayCellsForMonths(monthCount: number): number {
  return Math.max(0, monthCount) * 42;
}
