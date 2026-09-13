/**
 * Engine-facing DTOs for the shared financial calculation layer.
 *
 * These are plain JSON-serializable shapes. They are not Django/API models.
 * Amounts are decimal strings with 2-place semantics (e.g. "1000.00").
 * Dates are calendar days `YYYY-MM-DD` (no time, no timezone).
 */

/** Account snapshot already loaded by the caller (no DB access in the engine). */
export type EngineAccountSnapshot = {
  id: number;
  /**
   * Posted ledger balance immediately before pending rows.
   * This is the canonical walk anchor — not `today_balance`.
   */
  posted_balance_before_pending: string;
  /** Optional display/starting balance; unused by the canonical walk when the anchor is set. */
  starting_balance?: string;
  /** Forecast buffer compared against projected balances. Default "0.00". */
  minimum_buffer?: string;
};

export type EngineRowType = "INFLOW" | "OUTFLOW" | "INCOME" | "EXPENSE" | string;
export type EngineRowStatus = "PLANNED" | "CLEARED" | "RECONCILED" | string;
export type EngineRowSource = "actual" | "rule" | "one_time" | "interest" | string;

/**
 * One already-assembled ledger row. Row construction (recurring expansion,
 * matching, interest, checkpoints) remains server-side in Phase 1.
 */
export type EngineTimelineRowInput = {
  account_id: number;
  date: string;
  amount: string;
  type?: EngineRowType;
  status?: EngineRowStatus;
  source?: EngineRowSource;
  txn_source?: string | null;
  description?: string;
  transaction_id?: number | null;
  rule_id?: number | null;
  import_match_status?: string | null;
  plaid_transaction_id?: string | null;
  /**
   * When present, the walk trusts this flag. When omitted, the row participates.
   * Identity/supersede/shadow resolution is not ported in Phase 1.
   */
  financially_active?: boolean;
};

export type EngineTimelineRow = EngineTimelineRowInput & {
  /** Canonical Pending → Upcoming running balance after this row (2-decimal string). */
  balance_after?: string;
};

export type BuildTimelineInput = {
  accounts: readonly EngineAccountSnapshot[];
  rows: readonly EngineTimelineRowInput[];
  /** Calendar day used as as-of / today (`YYYY-MM-DD`). */
  today: string;
};

export type CalculateProjectedBalancesInput = {
  accounts: readonly EngineAccountSnapshot[];
  timelineRows: readonly EngineTimelineRow[];
  /** Inclusive forecast window start (as-of / today). */
  startDate: string;
  /** Inclusive forecast window end. */
  endDate: string;
};

export type ProjectedBalanceResult = {
  account_id: number;
  opening_balance: string;
  ending: string;
  lowest: string;
  lowest_date: string;
  first_negative_date: string | null;
  first_negative_balance: string | null;
  first_negative_transaction_id: number | null;
  first_below_buffer_date: string | null;
  first_below_buffer_balance: string | null;
};
