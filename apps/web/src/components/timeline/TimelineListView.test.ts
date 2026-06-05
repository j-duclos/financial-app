import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

describe("TimelineListView sticky months", () => {
  it("uses month grouping and sticky scroll container", () => {
    const source = readFileSync(join(dir, "TimelineListView.tsx"), "utf8");
    expect(source).toMatch(/groupTimelineDayGroupsByMonth/);
    expect(source).toMatch(/StickyMonthHeader/);
    expect(source).toMatch(/overflow-y-auto/);
    expect(source).toMatch(/TIMELINE_LIST_MONTH_STICKY_TOP/);
  });
});
