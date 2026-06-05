import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

describe("UpcomingList month separators", () => {
  it("renders sticky month headers via shared component", () => {
    const source = readFileSync(join(dir, "UpcomingList.tsx"), "utf8");
    expect(source).toMatch(/groupUpcomingByMonth/);
    expect(source).toMatch(/StickyMonthHeader/);
    expect(source).toMatch(/upcomingListUsesStickyScroll/);
  });
});
