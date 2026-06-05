import { describe, expect, it } from "vitest";
import type { TimelineCalendarDay } from "@budget-app/shared";
import {
  shouldShowTransferSimulation,
  suggestTransferAmount,
  simulationStatusLabel,
  transferSourceAccounts,
} from "./transferSimulation";

describe("transferSimulation", () => {
  it("shows simulation for dangerous days", () => {
    const day = {
      date: "2026-06-01",
      has_risk: true,
      heat_level: "dangerous",
    } as TimelineCalendarDay;
    expect(shouldShowTransferSimulation(day)).toBe(true);
  });

  it("suggests amount to cover negative lowest", () => {
    const day = {
      date: "2026-06-01",
      lowest_projected_balance: "-119.62",
      below_buffer_amount: "0",
    } as TimelineCalendarDay;
    expect(parseFloat(suggestTransferAmount(day))).toBeGreaterThan(119);
  });

  it("filters cash sources", () => {
    const accounts = [
      { id: 1, account_type: "CHECKING", name: "Main" },
      { id: 2, account_type: "SAVINGS", name: "Save" },
      { id: 3, account_type: "CREDIT", name: "Card" },
    ] as Parameters<typeof transferSourceAccounts>[0];
    expect(transferSourceAccounts(accounts).map((a) => a.id)).toEqual([1, 2]);
  });

  it("labels result status", () => {
    expect(simulationStatusLabel("resolved")).toBe("Risk resolved");
    expect(simulationStatusLabel("partial")).toBe("Still tight");
  });
});
