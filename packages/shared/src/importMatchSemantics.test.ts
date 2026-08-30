import { describe, expect, it } from "vitest";
import {
  isImportMatchStatusMatched,
  selectableImportMatchCandidates,
} from "./importMatchSemantics";

describe("importMatchSemantics", () => {
  it("detects matched import status case-insensitively", () => {
    expect(isImportMatchStatusMatched("matched")).toBe(true);
    expect(isImportMatchStatusMatched("MATCHED")).toBe(true);
    expect(isImportMatchStatusMatched("unmatched")).toBe(false);
    expect(isImportMatchStatusMatched(null)).toBe(false);
  });

  it("filters rejected import candidates", () => {
    const candidates = [
      { imported_transaction_id: 1, reject: null },
      { imported_transaction_id: 2, reject: "weak_payee" },
    ];
    expect(selectableImportMatchCandidates(candidates)).toEqual([candidates[0]]);
  });
});
