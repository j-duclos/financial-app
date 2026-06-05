import { describe, expect, it } from "vitest";
import {
  COLLAPSED_LEDGER_ROWS,
  ledgerSectionExpandTooltip,
} from "./ledgerTableLayout";

describe("ledgerSectionExpandTooltip", () => {
  it("describes past expand and collapse", () => {
    expect(ledgerSectionExpandTooltip("past", false)).toContain("Expand past");
    expect(ledgerSectionExpandTooltip("past", true)).toContain(
      `${COLLAPSED_LEDGER_ROWS}-row preview`
    );
  });

  it("describes forecast expand and collapse", () => {
    expect(ledgerSectionExpandTooltip("forecast", false)).toContain("Expand forecast");
    expect(ledgerSectionExpandTooltip("forecast", true)).toContain(
      `${COLLAPSED_LEDGER_ROWS}-row preview`
    );
  });
});
