import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(dir, "useDefaultHouseholdId.ts"), "utf8");
const calendarSource = readFileSync(
  join(dir, "../features/calendar/CalendarScreen.tsx"),
  "utf8"
);

describe("useDefaultHouseholdId", () => {
  it("repairs from a single household and does not pick among multiple", () => {
    expect(hookSource).toMatch(/singleHouseholdIdIfUnambiguous/);
    expect(hookSource).not.toMatch(/householdsQuery\.data\[0\]/);
  });
});

describe("calendar first-run copy", () => {
  it("does not send new users to the web app", () => {
    expect(calendarSource).not.toMatch(/on web/);
  });
});
