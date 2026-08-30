import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timelineSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Timeline.tsx"),
  "utf8"
);

describe("Calendar page structure", () => {
  it("loads calendar summary and month chunks instead of one full-range payload", () => {
    expect(timelineSource).toMatch(/useMoneyFlowCalendar/);
    expect(timelineSource).toMatch(/buildUpcomingMoneyFlowFromCalendarDays/);
    expect(timelineSource).not.toMatch(/getDashboardSummary/);
    expect(timelineSource).not.toMatch(/getDashboardSummaryFast/);
    expect(timelineSource).not.toMatch(/getDashboardDetails/);
  });

  it("does not fetch the full timeline list endpoint for list view", () => {
    expect(timelineSource).not.toMatch(/getTimeline\(/);
    expect(timelineSource).toMatch(/buildUpcomingMoneyFlowFromCalendarDays/);
  });

  it("renders timeline and calendar views separately", () => {
    expect(timelineSource).toMatch(/viewMode === "timeline"/);
    expect(timelineSource).toMatch(/viewMode === "calendar"/);
    expect(timelineSource).toMatch(/parseTimelineViewParam/);
    expect(timelineSource).not.toMatch(/TimelineListView/);
  });

  it("shows calculating placeholders for summary without blocking the calendar grid", () => {
    expect(timelineSource).toMatch(/Calculating\.\.\./);
    expect(timelineSource).toMatch(/ensureMonthLoaded/);
  });

  it("does not compute safe-until from calendar rows on the client", () => {
    expect(timelineSource).not.toMatch(/computeSafeUntilNextIncome/);
    expect(timelineSource).toMatch(/calendarSafeUntilPresentation/);
    expect(timelineSource).toMatch(/summary\.safe_until/);
    expect(timelineSource).not.toMatch(/safeUntilFromSummary/);
  });

  it("renders safe-until from explicit backend status", () => {
    expect(timelineSource).toMatch(/safeUntilPresentation/);
    expect(timelineSource).not.toMatch(/Safe-until summary not loaded/);
  });
});
