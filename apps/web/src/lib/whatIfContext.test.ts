import { describe, expect, it } from "vitest";
import { parsePositiveIntParam, whatIfDebtPath, whatIfGoalPath } from "./whatIfContext";

describe("whatIfContext", () => {
  it("builds goal and debt What-If URLs", () => {
    expect(whatIfGoalPath(12)).toBe("/scenarios?goal=12");
    expect(whatIfDebtPath(4)).toBe("/scenarios?debt=4");
  });

  it("parses optional integer context params", () => {
    expect(parsePositiveIntParam("9")).toBe(9);
    expect(parsePositiveIntParam("0")).toBeNull();
    expect(parsePositiveIntParam("abc")).toBeNull();
    expect(parsePositiveIntParam(null)).toBeNull();
  });
});
