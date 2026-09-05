import { describe, expect, it } from "vitest";
import {
  projectedPreviewViewState,
  projectedTransferBalancesViewState,
} from "./projectedBalancePreview";

describe("projectedPreviewViewState", () => {
  it("clears the previous card/date result until the matching response arrives", () => {
    expect(
      projectedPreviewViewState({
        previewActive: true,
        queryMatchesLiveInputs: false,
        isFetching: false,
        isError: false,
        previewOwedBefore: "412.18",
      })
    ).toEqual({ kind: "loading" });
  });

  it("shows loading while the matching request is in flight", () => {
    expect(
      projectedPreviewViewState({
        previewActive: true,
        queryMatchesLiveInputs: true,
        isFetching: true,
        isError: false,
        previewOwedBefore: "90.00",
      })
    ).toEqual({ kind: "loading" });
  });

  it("shows an error instead of a current-account fallback", () => {
    expect(
      projectedPreviewViewState({
        previewActive: true,
        queryMatchesLiveInputs: true,
        isFetching: false,
        isError: true,
        errorMessage: "Preview failed",
        previewOwedBefore: null,
      })
    ).toEqual({ kind: "error", message: "Preview failed" });
    expect(
      projectedPreviewViewState({
        previewActive: true,
        queryMatchesLiveInputs: true,
        isFetching: false,
        isError: false,
      })
    ).toEqual({ kind: "error", message: "Could not calculate projected balance." });
  });

  it("uses only the matching preview payload, including zero", () => {
    expect(
      projectedPreviewViewState({
        previewActive: true,
        queryMatchesLiveInputs: true,
        isFetching: false,
        isError: false,
        previewOwedBefore: "0.00",
      })
    ).toEqual({ kind: "ready", amount: 0 });
  });
});

describe("projectedTransferBalancesViewState", () => {
  it("does not keep a previous date's balances after the date changes", () => {
    expect(
      projectedTransferBalancesViewState({
        previewActive: true,
        queryMatchesLiveInputs: false,
        isFetching: false,
        isError: false,
        balanceBefore: "100",
        balanceAfter: "50",
      })
    ).toEqual({ kind: "loading" });
  });
});
