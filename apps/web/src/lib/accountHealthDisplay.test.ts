import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import { healthInlineLabel } from "./accountHealthDisplay";

describe("healthInlineLabel", () => {
  it("combines status and reason", () => {
    expect(healthInlineLabel("watch", "Safe-to-spend is low relative to balance")).toBe(
      "Watch — Safe-to-spend is low relative to balance"
    );
  });

  it("uses default reason for healthy when none provided", () => {
    expect(healthInlineLabel("healthy", null)).toBe("Healthy — Above buffer");
  });
});
