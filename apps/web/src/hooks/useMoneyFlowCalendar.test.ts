import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useMoneyFlowCalendar.ts"),
  "utf8"
);

describe("useMoneyFlowCalendar", () => {
  it("uses stable summary and chunk query keys scoped to filters", () => {
    expect(source).toMatch(/\["calendar-summary"/);
    expect(source).toMatch(/\["calendar-chunk"/);
    expect(source).toMatch(/\["calendar-timeline-upcoming"/);
    expect(source).toMatch(/horizon/);
    expect(source).toMatch(/lookbackMonths/);
    expect(source).toMatch(/accountId/);
    expect(source).toMatch(/scenarioId/);
  });

  it("does not fetch calendar chunks while Timeline view is active", () => {
    expect(source).toMatch(/viewMode === "calendar"/);
    expect(source).toMatch(/viewMode === "timeline"/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-chunk"\] \}\)/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-summary"\] \}\)/);
  });

  it("loads calendar summary in parallel with first chunk", () => {
    expect(source).toMatch(/shouldEagerFetchAllChunks/);
    expect(source).not.toMatch(/eagerAll \|\| firstChunkReady/);
    expect(source).not.toMatch(/lastEnabledSuccess && loadCount < windows.length/);
  });

  it("does not force a second first-chunk refetch after summary succeeds", () => {
    expect(source).not.toMatch(/chunkQueries\[0\]\.refetch\(\)/);
    expect(source).not.toMatch(/First-chunk refetch after full-range summary/);
  });

  it("loads later chunks from idle time or approaching a month, and passes abort signals", () => {
    expect(source).toMatch(/requestIdleCallback/);
    expect(source).toMatch(/shouldIdlePreloadNextChunk/);
    expect(source).toMatch(/ensureMonthLoaded/);
    expect(source).toMatch(/signal/);
  });

  it("reuses chunk windows across horizon changes via keys without horizon", () => {
    expect(source).toMatch(/\["calendar-chunk"/);
    expect(source).toMatch(/queryKey: \[[\s\S]*?"calendar-chunk"[\s\S]*?lookbackMonths/);
    expect(source).not.toMatch(/\["calendar-chunk",\s*horizon/);
  });
});
