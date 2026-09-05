import { projectedCardOwedFromPreview } from "./transferPreviewAccounts";

export type ProjectedPreviewView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; amount: number };

const DEFAULT_ERROR = "Could not calculate projected balance.";

/** UI state for a dated transfer/card preview. Stale keys never render as ready. */
export function projectedPreviewViewState(input: {
  previewActive: boolean;
  queryMatchesLiveInputs: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string | null;
  previewOwedBefore?: string | number | null;
  previewDestSignedBefore?: string | number | null;
}): ProjectedPreviewView {
  if (!input.previewActive) return { kind: "hidden" };
  if (!input.queryMatchesLiveInputs || input.isFetching) return { kind: "loading" };
  if (input.isError) {
    return { kind: "error", message: input.errorMessage?.trim() || DEFAULT_ERROR };
  }
  const amount = projectedCardOwedFromPreview({
    previewOwedBefore: input.previewOwedBefore,
    previewDestSignedBefore: input.previewDestSignedBefore,
  });
  if (amount == null) {
    return { kind: "error", message: DEFAULT_ERROR };
  }
  return { kind: "ready", amount };
}

export type ProjectedTransferBalancesView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; before: string; after: string };

export function projectedTransferBalancesViewState(input: {
  previewActive: boolean;
  queryMatchesLiveInputs: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string | null;
  balanceBefore?: string | number | null;
  balanceAfter?: string | number | null;
}): ProjectedTransferBalancesView {
  if (!input.previewActive) return { kind: "hidden" };
  if (!input.queryMatchesLiveInputs || input.isFetching) return { kind: "loading" };
  if (input.isError) {
    return { kind: "error", message: input.errorMessage?.trim() || DEFAULT_ERROR };
  }
  if (input.balanceBefore == null || input.balanceAfter == null) {
    return { kind: "error", message: DEFAULT_ERROR };
  }
  return {
    kind: "ready",
    before: String(input.balanceBefore),
    after: String(input.balanceAfter),
  };
}
