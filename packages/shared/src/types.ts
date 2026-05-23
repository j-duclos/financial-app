/** Account types matching backend AccountType enum */
export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT"
  | "CASH"
  | "INVESTMENT"
  | "RETIREMENT_401K"
  | "OTHER";

/** Account role/purpose for forecasting and safe-to-spend (matches backend AccountRole). */
export type AccountRole =
  | "spending"
  | "bills"
  | "savings"
  | "emergency_fund"
  | "credit_card"
  | "loan"
  | "investment"
  | "cash_reserve"
  | "other";

/** Category types */
export type CategoryType = "INCOME" | "EXPENSE";

/** Transaction direction for display */
export type TransactionDirection = "INFLOW" | "OUTFLOW";

export interface Household {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: number;
  household: Household;
  account_type: AccountType;
  role: AccountRole;
  role_display?: string;
  /** Amount to keep untouched in this account for safety. */
  minimum_buffer?: string;
  name: string;
  /** Short custom label shown throughout the app. */
  display_name?: string;
  /** How this account is mainly used (user-defined). */
  purpose?: string;
  /** Optional freeform notes (account detail / reminders). */
  notes?: string;
  /** Resolved UI label (display_name → legacy nickname → name). */
  effective_display_name?: string;
  /** Compact role + purpose for subtitles. */
  short_description?: string;
  /** @deprecated Use display_name. Kept for API compatibility. */
  nickname?: string | null;
  institution: string;
  /** Last four digits (digits only); used to attach Plaid imports to this account — not matched by name. */
  last_four?: string;
  currency: string;
  starting_balance?: string | null;
  apr?: string | null;
  /** APY % for savings accounts (interest paid/earned). */
  interest_rate?: string | null;
  /** Day of month (1-31) when interest is credited; for savings accounts. */
  interest_cycle_end_day?: number | null;
  /** Credit limit for credit cards; used to show available credit. */
  credit_limit?: string | null;
  /** Day of month (1-31) when billing cycle ends; for credit card interest. */
  billing_cycle_end_day?: number | null;
  /** Day of month (1-31) when the statement closes. */
  statement_closing_day?: number | null;
  /** Day of month (1-31) when payment is due. */
  payment_due_day?: number | null;
  /** Total amount currently owed (positive). Credit cards only. */
  current_balance?: string;
  /** Amount from last closed statement (positive owed). */
  statement_balance?: string;
  minimum_payment_amount?: string;
  last_statement_date?: string | null;
  next_statement_date?: string | null;
  next_payment_due_date?: string | null;
  autopay_enabled?: boolean;
  autopay_account?: number | null;
  autopay_type?: string;
  autopay_fixed_amount?: string;
  available_credit?: string | null;
  utilization_percent?: string | null;
  payoff_to_avoid_interest?: string | null;
  estimated_monthly_interest?: string | null;
  projected_interest_if_unpaid?: string | null;
  is_payment_due_soon?: boolean;
  days_until_due?: number | null;
  /** Promotional APR % (e.g. 0 for interest-free) until promotional_end_date. */
  promotional_apr?: string | null;
  /** Last date promotional APR applies (e.g. end of 0% intro period). */
  promotional_end_date?: string | null;
  is_active: boolean;
  /** Lifecycle: active | archived | closed | deleted */
  status?: "active" | "archived" | "closed" | "deleted";
  archived_at?: string | null;
  closed_at?: string | null;
  deleted_at?: string | null;
  is_hidden?: boolean;
  close_reason?: string;
  archive_reason?: string;
  preserve_in_net_worth?: boolean;
  plaid_sync_enabled?: boolean;
  /** When true, account is archived (inactive). Legacy; mirrors status. */
  archived?: boolean;
  /** When true, account is included in timeline scenarios. */
  include_in_forecast?: boolean;
  /**
   * When true, this ledger is manual-only (e.g. bank not on Plaid). Deleting or clearing the other
   * account's side of a linked transfer keeps this account's row and removes only the link.
   */
  preserve_partner_transfer_legs?: boolean;
  /** Display order in list (lower = higher). */
  position?: number;
  created_at: string;
  updated_at: string;
  /** Today's balance (signed; for CREDIT, negative = debt). Used for calculations. */
  balance?: string;
  /** For bank: today's balance. For credit: available credit (credit_limit - debt). */
  available_balance?: string | null;
  /** For credit: amount owed (positive). For bank: null (show N/A). */
  balance_owed?: string | null;
  /** Forecast-aware spendable cash (cash accounts only). */
  available_to_spend?: string | null;
  projected_balance_30_days?: string | null;
  lowest_projected_balance_30_days?: string | null;
  upcoming_inflows_30_days?: string | null;
  upcoming_outflows_30_days?: string | null;
  risk_status?: "healthy" | "watch" | "risk" | "critical" | null;
  risk_date?: string | null;
  risk_reason?: string | null;
  /** Computed account health (all account types). */
  health_status?: "healthy" | "watch" | "risk" | "critical" | null;
  health_score?: number | null;
  health_reason?: string | null;
  health_risk_date?: string | null;
  health_details?: AccountHealthDetails | null;
  health_recommended_action?: string | null;
  outgoing_relationships?: AccountRelationship[];
  incoming_relationships?: AccountRelationship[];
}

export type AccountRelationshipType =
  | "autopay"
  | "transfer"
  | "savings_funding"
  | "debt_payment"
  | "credit_card_payment"
  | "loan_payment"
  | "investment_contribution"
  | "bill_funding"
  | "paycheck_deposit"
  | "other";

export type AccountRelationshipFrequency =
  | "one_time"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "twice_monthly"
  | "quarterly"
  | "yearly"
  | "custom";

export interface AccountRelationship {
  id: number;
  source_account: number;
  source_account_name: string;
  destination_account: number;
  destination_account_name: string;
  relationship_type: AccountRelationshipType;
  relationship_type_display: string;
  default_amount?: string | null;
  default_day?: number | null;
  frequency: AccountRelationshipFrequency;
  is_active: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AccountHealthDetails {
  lowest_projected_balance?: string | null;
  available_to_spend?: string | null;
  minimum_buffer?: string | null;
  utilization_percent?: string | null;
  days_until_due?: number | null;
  past_due_amount?: string | null;
  unmatched_import_count?: number | null;
}

export interface AccountForecastSummary {
  account_id: number;
  available_to_spend: string | null;
  projected_balance_30_days: string | null;
  lowest_projected_balance_30_days: string | null;
  upcoming_inflows_30_days: string | null;
  upcoming_outflows_30_days: string | null;
  risk_status: string | null;
  risk_date: string | null;
  risk_reason: string | null;
  forecast_summary?: Record<string, unknown>;
}

export interface SafeToSpendDashboard {
  days: number;
  total_safe_to_spend: string;
  accounts_at_risk_count: number;
  accounts_at_risk: Array<{
    account_id: number;
    account_name: string;
    risk_status: string;
    available_to_spend: string;
    risk_date: string | null;
    risk_reason: string | null;
  }>;
  next_risk_date: string | null;
  worst_projected_account: {
    account_id: number;
    account_name: string;
    lowest_projected_balance: string;
    risk_date: string | null;
  } | null;
  accounts_needing_attention_count?: number;
  critical_accounts_count?: number;
  accounts_needing_attention?: Array<{
    account_id: number;
    account_name: string;
    health_status: string;
    health_score?: number;
    health_reason: string | null;
    health_risk_date: string | null;
  }>;
  next_health_risk_date?: string | null;
  next_health_issue_text?: string | null;
  worst_health_account?: {
    account_id: number;
    account_name: string;
    health_status: string;
    health_score?: number;
    health_reason: string | null;
    health_risk_date: string | null;
  } | null;
}

export interface Category {
  id: number;
  household: number;
  parent: number | null;
  name: string;
  category_type: CategoryType;
  is_system: boolean;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  account: Account;
  account_id?: number;
  date: string;
  payee: string;
  memo: string;
  amount: string;
  direction: TransactionDirection;
  category: Category | null;
  category_id?: number | null;
  cleared: boolean;
  reconciled: boolean;
  reconciled_at?: string | null;
  reconciliation_id?: number | null;
  tags: string[];
  /** The other account in a linked transfer (destination when this is the outflow leg, source when this is the inflow leg). */
  transfer_to_account?: Account | null;
  /** Set on PATCH to change the transfer's destination account (credit account). */
  transfer_to_account_id?: number | null;
  status?: string;
  source?: string;
  /** Billing cycle end this interest charge belongs to (INTEREST source); display date may differ. */
  interest_cycle_end_date?: string | null;
  rule_id?: number | null;
  /** Other leg of the same transfer (Transfer row or rule-matched pair), when present. */
  linked_transaction_id?: number | null;
  /** Plaid server transaction id when source is PLAID (dedupe / sync). */
  plaid_transaction_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: number;
  household: number;
  category: Category;
  year: number;
  month: number;
  planned_amount: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlySummary {
  month: string;
  total_income: string;
  total_expenses: string;
  net: string;
}

export interface CategoryBreakdownItem {
  category_id: number | null;
  category_name: string;
  total: string;
}

export interface AccountBalance {
  account_id: number;
  account_name: string;
  balance: string;
}

// Timeline / Rules / Scenarios
export type RecurringRuleDirection = "INCOME" | "EXPENSE" | "TRANSFER";
export type RecurringRuleFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY_DAY"
  | "MONTHLY_NTH_WEEKDAY"
  | "YEARLY";

export interface RecurringRule {
  id: number;
  household: number;
  name: string;
  account: Account;
  account_id?: number;
  transfer_to_account?: Account | null;
  transfer_to_account_id?: number | null;
  category: Category | null;
  category_id?: number | null;
  direction: RecurringRuleDirection;
  amount: string;
  currency: string;
  frequency: RecurringRuleFrequency;
  interval: number;
  day_of_week: number | null;
  day_of_month: number | null;
  nth_week: number | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  id: number;
  household: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioRuleOverride {
  id: number;
  scenario: number;
  rule: RecurringRule;
  rule_id?: number;
  override_amount: string | null;
  override_active: boolean | null;
  override_start_date: string | null;
  override_end_date: string | null;
  override_account: Account | null;
  override_account_id?: number | null;
  override_category: Category | null;
  override_category_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineRow {
  date: string;
  description: string;
  account_id: number;
  account_name: string;
  category_id: number | null;
  category_name: string | null;
  amount: string;
  type: string;
  status: string;
  source: "actual" | "rule" | "interest";
  rule_id: number | null;
  transaction_id: number | null;
  running_balance: string;
}

export interface TimelineResponse {
  timeline: TimelineRow[];
  account_summary: { account_id: number; account_name: string; ending_balance: string }[];
}

export interface StatementTransaction {
  id: number;
  household?: number;
  account: Account;
  account_id?: number;
  posted_date: string;
  description: string;
  amount: string;
  external_id?: string | null;
  raw?: unknown;
  created_at: string;
}

export interface ReconciliationMatch {
  id: number;
  statement_txn: StatementTransaction;
  matched_transaction: Transaction | null;
  matched_transaction_id?: number | null;
  status: "MATCHED" | "UNMATCHED";
  matched_at: string | null;
}

/** Ledger row shown on the bank reconciliation checklist. */
export interface ReconcileTransactionRow {
  id: number;
  date: string;
  payee: string;
  memo: string;
  amount: string;
  direction: TransactionDirection;
  category: string | null;
  source: string;
  cleared: boolean;
  reconciled: boolean;
  running_balance: string | null;
}

export interface ReconcileSetupResponse {
  account_id: number;
  last_reconciled_balance: string;
  period_opening_balance: string;
  app_current_balance: string;
  is_first_reconciliation: boolean;
  account_starting_balance: string | null;
  min_start_date: string;
  period_start_date: string;
  period_end_date: string;
  last_reconcile_period_end: string | null;
  max_end_date: string;
  unreconciled_transactions: ReconcileTransactionRow[];
}

export interface ReconcileCompleteResponse {
  id: number;
  account_id: number;
  bank_current_balance: string;
  app_current_balance: string;
  last_reconciled_balance: string;
  final_reconciled_balance: string;
  difference: string;
  period_start_date: string | null;
  period_end_date: string | null;
  status: string;
  completed_at: string | null;
  checked_transaction_ids: number[];
}

/** In-app notification for a recurring rule charge due within the next few days. */
export interface UpcomingChargeNotification {
  id: number;
  rule_id: number;
  rule_name: string;
  rule_amount: string;
  rule_currency: string;
  account_name: string;
  due_date: string;
  created_at: string;
  read_at: string | null;
}
