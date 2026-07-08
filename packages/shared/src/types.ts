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
  /** Target utilization % for credit health scoring (default 10). */
  target_utilization_percent?: string | null;
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
  /** Next billing cycle close (YYYY-MM-DD); mirrors next_statement_date when closing day is set. */
  billing_cycle_end_date?: string | null;
  next_payment_due_date?: string | null;
  /** Forecasted balance owed at billing_cycle_end_date (ledger + projected activity). */
  projected_statement_balance?: string | null;
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
  /** When false, card is omitted from dashboard Available Credit totals. */
  include_in_available_credit?: boolean;
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
  lowest_projected_balance_date_30_days?: string | null;
  first_negative_balance?: string | null;
  first_below_buffer_balance?: string | null;
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
  /** Most recent ledger-visible transaction date (YYYY-MM-DD), if any. */
  last_activity_date?: string | null;
  /** Compact payoff projection at minimum payment (when ?balance=true). */
  payoff_estimate?: PayoffEstimateSummary | null;
}

export interface PayoffEstimateSummary {
  label: string;
  payoff_possible?: boolean;
  months_to_payoff?: number | null;
  payment_amount?: string;
  payoff_date?: string | null;
  total_interest?: string;
}

export type PayoffStrategy =
  | "minimum_payment"
  | "statement_balance"
  | "fixed_amount"
  | "current_balance"
  | "custom_amount";

export interface PayoffScheduleRow {
  month: number;
  starting_balance: string;
  interest_charged: string;
  payment: string;
  principal_paid: string;
  ending_balance: string;
}

export interface PayoffProjection {
  payoff_possible: boolean;
  message?: string;
  starting_balance: string;
  apr: string;
  monthly_interest_rate: string;
  payment_amount: string;
  strategy?: PayoffStrategy;
  payoff_date: string | null;
  months_to_payoff: number;
  total_interest: string;
  total_paid: string;
  schedule: PayoffScheduleRow[];
  /** @deprecated Legacy field; use starting_balance */
  current_balance?: string;
}

export interface PayoffStrategyComparison {
  account_id: number;
  starting_balance: string;
  strategies: Record<string, PayoffProjection>;
}

export type DebtPayoffStrategy = "avalanche" | "snowball" | "utilization_target" | "custom";
export type DebtPayoffMode = "survival" | "aggressive" | "credit_score" | "balanced";

export interface DebtPayoffCardSummary {
  account_id: number;
  name: string;
  balance: string;
  apr: string;
  credit_limit: string | null;
  utilization_percent: string | null;
  minimum_payment: string;
  suggested_payment: string;
  payoff_date: string | null;
  months_remaining: number | null;
  total_projected_interest: string | null;
  interest_this_month: string;
  payoff_order: number | null;
  promotional_apr: string | null;
  promotional_end_date: string | null;
  autopay_enabled: boolean;
}

export interface DebtMilestone {
  id: string;
  label: string;
  achieved: boolean;
  description: string;
}

export interface DebtRecommendation {
  id: string;
  priority: string;
  message: string;
}

export interface DebtPayoffPlan {
  as_of: string;
  strategy: DebtPayoffStrategy;
  mode: DebtPayoffMode;
  extra_monthly: string;
  monthly_payment_budget: string;
  total_debt: string;
  weighted_apr: string;
  monthly_interest_burn: string;
  debt_free_date: string | null;
  months_to_debt_free: number | null;
  debt_free_possible: boolean;
  total_interest: string;
  total_paid?: string;
  total_interest_minimums_only?: string;
  interest_saved_vs_minimums: string;
  payoff_order: number[];
  cards: DebtPayoffCardSummary[];
  timeline: Array<{
    month: number;
    date: string;
    total_balance: string;
    interest_charged: string;
    total_paid: string;
    balances_by_account: Record<string, string>;
  }>;
  milestones: DebtMilestone[];
  recommendations: DebtRecommendation[];
  utilization_forecast: Array<{
    month: number;
    date?: string;
    by_account: Record<string, string>;
  }>;
}

export interface DashboardDebtSummary {
  label: string;
  debt_free_date: string | null;
  total_debt: string;
  monthly_interest_burn: string;
  interest_saved_vs_minimums: string | null;
  message: string | null;
  planner_url: string;
}

export interface CreditCardInterestReport {
  month: string;
  by_card: Array<{
    account_id: number;
    account_name: string;
    interest_paid: string;
    projected_interest_remaining: string;
  }>;
  total_interest_paid: string;
  total_projected_interest_remaining: string;
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
  first_negative_balance?: string | null;
  first_below_buffer_balance?: string | null;
  available_to_spend?: string | null;
  minimum_buffer?: string | null;
  utilization_percent?: string | null;
  target_utilization_percent?: string | null;
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

export interface DashboardAttentionAction {
  label: string;
  type: "open_ledger" | "move_money" | "make_payment" | "view_account";
  url: string;
}

export interface DashboardAttentionItem {
  account_id: number;
  account_name: string;
  account_role: AccountRole;
  account_type: AccountType;
  status: "healthy" | "watch" | "risk" | "critical";
  reason: string;
  /** Credit utilization target % when reason involves card utilization. */
  target_utilization_percent?: string | null;
  recommended_action: string | null;
  amount: string | null;
  risk_date: string | null;
  primary_action: DashboardAttentionAction;
  secondary_action: DashboardAttentionAction | null;
  url: string;
}

export interface DashboardUpcomingItem {
  date: string;
  account_id: number;
  account_name: string;
  description: string;
  amount: string | null;
  kind: "income" | "bill" | "transfer" | "credit_card" | "risk";
  projected_balance: string | null;
  is_risk?: boolean;
}

export interface DashboardUpcomingTransaction {
  id: string;
  date: string;
  account_id: number;
  account_name: string;
  description: string;
  amount: string | null;
  kind: "income" | "bill" | "transfer" | "credit_card" | "risk";
  category: string | null;
  balance_after: string | null;
  is_transfer: boolean;
  is_internal_transfer: boolean;
  is_credit_card_payment: boolean;
  /** Set for transfer-rule legs: paying account name. */
  transfer_from_account_name?: string | null;
  /** Set for transfer-rule legs: receiving account name. */
  transfer_to_account_name?: string | null;
  source: string | null;
  status: string | null;
  risk_flag: boolean;
}

export type DayHeatLevel = "neutral" | "healthy" | "tight" | "dangerous";

export interface DayHeatSummary {
  heat_level: DayHeatLevel;
  heat_label: string;
  heat_reason: string | null;
  affected_account_name: string | null;
  lowest_projected_balance: string | null;
  below_buffer_amount: string | null;
  is_negative: boolean;
}

/** Intra-day worst cash balance marker (Timeline / Dashboard upcoming). */
export interface DayLowestBalanceMarker {
  lowest_projected_balance?: string | null;
  lowest_projected_balance_account_id?: number | null;
  lowest_projected_balance_account_name?: string | null;
  lowest_projected_balance_transaction_id?: string | number | null;
  lowest_projected_balance_after_description?: string | null;
  lowest_projected_balance_date?: string | null;
  amount_needed_to_zero?: string | null;
  amount_needed_to_buffer?: string | null;
  show_lowest_balance_marker?: boolean;
}

export type DashboardUpcomingHeatLevel = "healthy" | "tight" | "dangerous" | "neutral";

export interface DashboardUpcomingLowestBalance {
  account_name: string;
  balance: string;
}

/** Credit-card day header warning (utilization / over limit). */
export interface CreditBalanceWarning {
  account_name: string;
  message: string;
  severity?: "dangerous" | "tight" | "watch";
}

export interface DashboardUpcomingGroup extends DayLowestBalanceMarker, DayRecoveryInfo {
  date: string;
  label: string;
  day_of_week: string;
  month_key?: string;
  month_label?: string;
  income_total: string;
  expense_total: string;
  net_total: string;
  transfer_total: string;
  transfers_excluded: boolean;
  has_risk: boolean;
  risk_reason: string | null;
  heat_level?: DashboardUpcomingHeatLevel;
  heat_label?: string;
  heat_reason?: string | null;
  affected_account_name?: string | null;
  below_buffer_amount?: string | null;
  is_negative?: boolean;
  lowest_projected_balances?: DashboardUpcomingLowestBalance[];
  credit_balance_warnings?: CreditBalanceWarning[];
  transactions: DashboardUpcomingTransaction[];
  hidden_transaction_count: number;
  total_transaction_count: number;
  visible_transaction_limit?: number;
  biggest_drivers?: TimelineDayDriver[];
}

export type FinancialGoalType =
  | "savings"
  | "debt_payoff"
  | "emergency_fund"
  | "house_down_payment"
  | "college"
  | "vacation"
  | "taxes"
  | "car"
  | "purchase"
  | "custom"
  | "emergency"
  | "house"
  | "education"
  | "retirement";

export type GoalBucketType =
  | "emergency"
  | "purchase"
  | "vacation"
  | "house"
  | "education"
  | "debt_payoff"
  | "retirement"
  | "custom";

export type GoalBucketPriority = "high" | "medium" | "low";

export interface GoalWarning {
  goal_id?: number;
  bucket_id: number;
  name: string;
  message: string;
  gap: string;
}

export type FinancialGoalStatus = "active" | "paused" | "completed" | "archived";

export type GoalOnTrackStatus = "on_track" | "behind" | "ahead" | "no_target_date";

export type GoalHealthStatus =
  | "ahead"
  | "on_track"
  | "watch"
  | "behind"
  | "completed"
  | "no_schedule";

export interface GoalMilestone {
  percent: number;
  label: string;
  threshold_amount: string;
  achieved: boolean;
}

export interface GoalsAggregateSummary {
  total_saved: string;
  total_target: string;
  monthly_needed_total: string;
  goals_on_track: number;
  goals_active_count: number;
  projected_completion: string | null;
  warnings?: GoalWarning[];
}

export interface GoalContributePreview {
  current_amount: string;
  after_amount: string;
  progress_percent: string;
  after_progress_percent: string;
  safe_to_spend_before: string | null;
  safe_to_spend_after: string | null;
  can_transfer: boolean;
  funding_account_id: number | null;
  funding_account_name: string | null;
  requires_linked_account_for_transfer: boolean;
}

export type GoalForecastStatus = "ahead" | "on_track" | "behind" | "never" | "completed";

export type GoalPaceStatus = "ahead" | "on_track" | "behind" | "stalled" | "completed";

export interface GoalLinkedRule {
  rule_id: number;
  rule_name: string;
  amount: string;
  frequency: string;
  frequency_label: string;
  label: string;
}

export interface GoalForecastScenario {
  id: string;
  label: string;
  monthly_pace: string | null;
  projected_completion_date: string | null;
  headline: string;
}

export interface GoalForecastGrowthPoint {
  month: string;
  label: string;
  amount: string;
}

export interface GoalScenarioProjection {
  scenario_id: number;
  scenario_name: string;
  projected_completion_date: string | null;
  projection_headline: string;
  contribution_pace_monthly: string | null;
}

export interface GoalForecastDetail {
  projected_completion_date: string | null;
  monthly_required: string | null;
  current_contribution_rate: string | null;
  forecast_gap: string | null;
  on_track_status: GoalOnTrackStatus;
  goal_health: GoalHealthStatus;
  forecast_status?: GoalForecastStatus;
  pace_status?: GoalPaceStatus;
  projection_headline?: string | null;
  suggested_monthly?: string | null;
  suggested_biweekly?: string | null;
  suggested_weekly?: string | null;
  automatic_transfer_label?: string | null;
  pace_warnings?: string[];
  recommendation: string | null;
}

export interface GoalDetailResponse {
  goal: FinancialGoal;
  contribution_history: Array<{
    id: number;
    amount: string;
    date: string;
    source: string;
    account_id: number;
    account_name: string | null;
    notes: string;
  }>;
  linked_rules: GoalLinkedRule[];
  forecast_growth: GoalForecastGrowthPoint[];
  forecast_scenarios: GoalForecastScenario[];
  scenario_projection?: GoalScenarioProjection;
}

export interface GoalsReport {
  buckets: FinancialGoal[];
  contribution_history: Array<{
    id: number;
    bucket_id: number;
    bucket_name: string;
    account_id: number;
    amount: string;
    date: string;
    source: string;
  }>;
  monthly_funding: Array<{ month: string; total: string }>;
  summary: GoalsAggregateSummary;
}

export interface FinancialGoal {
  id: number;
  household: number;
  name: string;
  goal_type: FinancialGoalType;
  target_amount: string;
  current_amount: string;
  starting_debt_amount?: string | null;
  target_date: string | null;
  linked_account: number | null;
  linked_credit_account: number | null;
  linked_account_name?: string | null;
  linked_credit_account_name?: string | null;
  monthly_contribution: string;
  contribution_rule?: number | null;
  priority: number | GoalBucketPriority;
  status: FinancialGoalStatus;
  allocated_amount?: string;
  include_in_safe_to_spend?: boolean;
  forecast_enabled?: boolean;
  auto_fund_enabled?: boolean;
  forecast_status?: GoalForecastStatus;
  description?: string;
  start_date?: string | null;
  monthly_target?: string;
  notes: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  remaining_amount: string;
  progress_percent: string;
  projected_completion_date: string | null;
  on_track_status: GoalOnTrackStatus;
  recommended_monthly_contribution: string | null;
  linked_account_balance?: string | null;
  linked_debt_balance?: string | null;
  is_debt_goal: boolean;
  goal_health: GoalHealthStatus;
  monthly_required: string | null;
  current_contribution_rate: string | null;
  forecast_gap: string | null;
  funding_account: string | null;
  funding_account_id?: number | null;
  funding_account_name?: string | null;
  funding_source_label?: string | null;
  pace_status?: GoalPaceStatus;
  projection_headline?: string | null;
  contribution_recommendation?: string | null;
  suggested_monthly?: string | null;
  suggested_biweekly?: string | null;
  suggested_weekly?: string | null;
  suggested_contribution_amount?: string | null;
  automatic_transfer_label?: string | null;
  has_automatic_funding?: boolean;
  linked_rules?: GoalLinkedRule[];
  pace_warnings?: string[];
  contribution_pace_monthly?: string | null;
  pace_avg_3mo?: string | null;
  pace_avg_6mo?: string | null;
  milestones: GoalMilestone[];
}

export interface DashboardGoalSummary {
  id: number;
  name: string;
  goal_type: FinancialGoalType;
  current_amount: string;
  target_amount: string;
  remaining_amount: string;
  progress_percent: string;
  projected_completion_date: string | null;
  on_track_status: GoalOnTrackStatus;
  recommended_monthly_contribution: string | null;
  priority: number;
  status: FinancialGoalStatus;
  target_date: string | null;
  linked_account_name: string | null;
  is_debt_goal: boolean;
  linked_debt_balance?: string | null;
  goal_health?: GoalHealthStatus;
  pace_status?: GoalPaceStatus;
  projection_headline?: string | null;
  contribution_recommendation?: string | null;
  funding_account_name?: string | null;
  automatic_transfer_label?: string | null;
  monthly_required?: string | null;
}

export type DashboardInsightSeverity = "critical" | "warning" | "info" | "positive";

export interface DashboardInsight {
  id: string;
  severity: DashboardInsightSeverity;
  title: string;
  message: string;
  metric_label: string | null;
  metric_value: string | null;
  action_label: string | null;
  action_url: string | null;
  secondary_action_label: string | null;
  secondary_action_url: string | null;
}

export type RecommendationType =
  | "move_money"
  | "pay_credit_card"
  | "reduce_utilization"
  | "delay_bill"
  | "reduce_spending"
  | "pause_subscription"
  | "increase_goal_contribution"
  | "decrease_goal_contribution"
  | "avoid_purchase"
  | "survival_mode"
  | "debt_payoff"
  | "restore_buffer"
  | "reconcile_account";

export interface DashboardRecommendation {
  id: string;
  severity: DashboardInsightSeverity;
  title: string;
  why: string;
  recommended_action: string | null;
  impact_label: string | null;
  impact_value: string | null;
  primary_action_label: string | null;
  primary_action_url: string | null;
  primary_action_type: string | null;
  secondary_action_label: string | null;
  secondary_action_url: string | null;
  secondary_action_type: string | null;
  type?: RecommendationType | string | null;
  priority_score?: number;
  recommended_amount?: string | null;
  recommended_date?: string | null;
  account_id?: number | null;
  related_account_id?: number | null;
  rule_id?: number | null;
  goal_id?: number | null;
  impact_type?: string | null;
  projected_improvement?: string | null;
}

export interface RecommendationTimelineHint {
  date: string;
  recommendation_id: string;
  title: string;
  severity: string;
  type?: string | null;
}

export interface DashboardTopSummary {
  liquid_cash: string;
  available_credit: string;
  /** Sum of credit limits on active credit accounts (same scope as available_credit). */
  total_credit_limit: string | null;
  credit_utilization: string | null;
  net_position: string;
}

export interface DashboardForecastRisk {
  next_risk_date: string | null;
  lowest_projected_balance: string | null;
  lowest_projected_balance_account_id?: number | null;
  lowest_projected_balance_account_name?: string | null;
}

/** Above-the-fold dashboard payload for fast first paint. */
export interface DashboardSummaryFast {
  safe_to_spend: DashboardSummary["safe_to_spend"];
  top_summary?: DashboardTopSummary;
  attention: DashboardAttentionItem[];
  attention_total_count: number;
  debt?: DashboardDebtSummary;
  insights: DashboardInsight[];
  recommendations?: DashboardRecommendation[];
  forecast_risk: DashboardForecastRisk;
}

/** Lazy-loaded dashboard sections loaded after first paint. */
export interface DashboardSummaryDetails {
  upcoming: DashboardUpcomingItem[];
  upcoming_groups: DashboardUpcomingGroup[];
  upcoming_truncated?: boolean;
  upcoming_total_count?: number;
  upcoming_days: number;
  snapshot: DashboardSnapshot;
  goals: DashboardGoalSummary[];
  goal_warnings?: GoalWarning[];
  goals_summary?: GoalsAggregateSummary;
  bills?: DashboardBillsSummary;
  recommendation_hints?: RecommendationTimelineHint[];
  recommendations?: DashboardRecommendation[];
  net_worth: string;
  month_to_date: DashboardSummary["month_to_date"];
}

export interface DashboardSummary {
  safe_to_spend: {
    window_days: number;
    amount: string;
    status: "healthy" | "watch" | "critical";
    next_issue: {
      account_id: number;
      account_name: string;
      risk_date: string | null;
      reason: string;
      recommended_action: string | null;
    } | null;
  };
  top_summary?: DashboardTopSummary;
  forecast_risk?: DashboardForecastRisk;
  net_worth: string;
  month_to_date: {
    month: string;
    income: string;
    expenses: string;
    net: string;
  };
  attention: DashboardAttentionItem[];
  attention_total_count: number;
  upcoming: DashboardUpcomingItem[];
  upcoming_groups: DashboardUpcomingGroup[];
  upcoming_truncated?: boolean;
  upcoming_total_count?: number;
  upcoming_days: number;
  snapshot: DashboardSnapshot;
  goals: DashboardGoalSummary[];
  goal_warnings?: GoalWarning[];
  goals_summary?: GoalsAggregateSummary;
  insights: DashboardInsight[];
  recommendations?: DashboardRecommendation[];
  recommendation_hints?: RecommendationTimelineHint[];
  bills?: DashboardBillsSummary;
  debt?: DashboardDebtSummary;
}

/** Compact dashboard snapshot strip (Section 5). */
export interface DashboardSnapshot {
  cash: string;
  cash_change_pct: string | null;
  credit_debt: string;
  utilization: string | null;
  savings: string;
  savings_change_pct: string | null;
  net_position: string;
  net_position_change_pct: string | null;
  /** Average active-goal progress %; omitted when no goals. */
  savings_goal_progress_pct?: string | null;
  /** @deprecated Removed from dashboard snapshot footer — use Reports for MTD. */
  net_position_mtd_positive?: boolean | null;
  /** @deprecated Use utilization */
  credit_utilization?: string;
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
  import_match_status?: string | null;
  is_bill?: boolean;
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

export type SpendingTargetPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

export type SpendingTargetType = "fixed" | "variable";

export type SpendingTargetForecastMethod = "scheduled_only";

export type SpendingTargetStatus =
  | "within_target"
  | "approaching_target"
  | "above_target"
  | "risky";

export interface SpendingTargetMetrics {
  target_id: number;
  category_id: number;
  category_name: string;
  name: string;
  period: SpendingTargetPeriod;
  target_type: SpendingTargetType;
  forecast_method: SpendingTargetForecastMethod;
  period_start: string;
  period_end: string;
  target_amount: string;
  spent_so_far: string;
  /** Known future scheduled amounts in the period. */
  scheduled_in_period: string;
  /** Spent + scheduled; used for status/progress only. */
  forecast_amount: string;
  remaining_to_target: string;
  percent_used: string;
  status: SpendingTargetStatus;
  recommendation: string | null;
  forecast_summary: string | null;
  forecast_impact: string | null;
  account_id: number | null;
  warning_threshold_percent: string;
  hard_limit: boolean;
  active: boolean;
}

export interface SpendingTarget {
  id: number;
  household: number;
  category: Category;
  name: string;
  target_amount: string;
  period: SpendingTargetPeriod;
  target_type: SpendingTargetType;
  account: number | null;
  active: boolean;
  warning_threshold_percent: string;
  hard_limit: boolean;
  notes: string;
  metrics?: SpendingTargetMetrics;
  created_at: string;
  updated_at: string;
}

export interface SpendingTargetsSummary {
  anchor_date: string;
  total_monthly_targets: string;
  spent_so_far_total: string;
  scheduled_in_period_total: string;
  above_target_count: number;
  approaching_target_count: number;
  targets: SpendingTargetMetrics[];
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

/** Future-dated schedule segment (amount/cadence change not yet active on the rule row). */
export interface RecurringRuleScheduledChange {
  effective_from: string;
  account_id: number;
  transfer_to_account_id: number | null;
  category_id: number | null;
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
}

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
  paused_at: string | null;
  notes: string | null;
  is_bill?: boolean;
  payment_flexibility_days?: number;
  scheduled_change?: RecurringRuleScheduledChange | null;
  created_at: string;
  updated_at: string;
}

export type BillChecklistStatus =
  | "projected"
  | "due_soon"
  | "paid"
  | "reconciled"
  | "late"
  | "likely_forgotten"
  | "missed"
  | "skipped";

export interface BillWarning {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface BillChecklistItem {
  id: number;
  name: string;
  account: { id: number; name: string };
  due_date: string;
  amount: string;
  average_amount?: string | null;
  category: { id: number; name: string } | null;
  source_type: "rule" | "manual" | "imported";
  transaction_id: number | null;
  rule_id: number | null;
  status: BillChecklistStatus;
  base_status?: string;
  paid_date: string | null;
  matched_transaction_id: number | null;
  is_overdue: boolean;
  days_until_due: number;
  skipped: boolean;
  notes: string;
  payment_confidence?: "high" | "medium" | "low";
  payment_confidence_score?: number;
  likely_forgotten?: boolean;
  autopay_mode?: "manual" | "autopay" | "unknown";
  autopay_confidence?: "high" | "medium" | "low";
  autopay_label?: string | null;
  autopay_risk?: boolean;
  warnings?: BillWarning[];
}

export interface MonthlyBillChecklist {
  month: string;
  total_projected: string;
  total_paid: string;
  total_remaining: string;
  missed_count: number;
  late_count?: number;
  due_soon_count?: number;
  forgotten_count?: number;
  overdue_count?: number;
  total_count: number;
  paid_count: number;
  remaining_count?: number;
  warnings?: BillWarning[];
  items: BillChecklistItem[];
  is_projection_month?: boolean;
}

export interface BillsOverviewResponse {
  center_month: string;
  months: MonthlyBillChecklist[];
  checklist: MonthlyBillChecklist;
  warnings: BillWarning[];
}

export interface BillOccurrenceDetail {
  occurrence: BillChecklistItem;
  payment_history: Array<{
    id: number;
    date: string;
    amount: string;
    payee: string;
    status: string;
    source: string;
    reconciled: boolean;
  }>;
  amount_trend: Array<{ month: string; label: string; amount: string | null }>;
  linked_transactions: Array<{ id: number; date: string; amount: string; payee: string }>;
  rule: { id: number; name: string; frequency: string; amount: string } | null;
}

export interface DashboardBillsSummary {
  month: string;
  paid_count: number;
  total_count: number;
  missed_count: number;
  late_count?: number;
  forgotten_count?: number;
  due_soon_count?: number;
  remaining_count?: number;
  total_remaining?: string;
  label: string;
  missed_message: string | null;
  checklist_url: string;
  warnings?: BillWarning[];
}

export type SubscriptionIntelligenceSource = "recurring_rule" | "detected";

export interface SubscriptionIntelligenceItem {
  id: string;
  source: SubscriptionIntelligenceSource;
  rule_id: number | null;
  name: string;
  monthly_amount: string;
  category: string | null;
  account_name: string | null;
  active: boolean;
  charge_count: number | null;
  last_charge_date: string | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface SubscriptionIntelligenceResponse {
  monthly_commitments_total: string;
  subscription_count: number;
  subscriptions: SubscriptionIntelligenceItem[];
  suggested: SubscriptionIntelligenceItem[];
  suggested_monthly_total: string;
}

export type ScenarioTemplateKey =
  | "blank"
  | "buy_house"
  | "lose_job"
  | "move"
  | "raise_income"
  | "pay_off_debt"
  | "new_car"
  | "custom";

export interface Scenario {
  id: number;
  household: number;
  name: string;
  description: string;
  template: ScenarioTemplateKey;
  horizon_months: number;
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
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioAddedRecurring {
  id: number;
  scenario: number;
  name: string;
  account: Account;
  account_id?: number;
  transfer_to_account?: Account | null;
  transfer_to_account_id?: number | null;
  category: Category | null;
  category_id?: number | null;
  direction: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: string;
  currency: string;
  frequency: RecurringRuleFrequency;
  interval: number;
  day_of_week: number | null;
  day_of_month: number | null;
  nth_week: number | null;
  start_date: string;
  end_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioOneTimeEvent {
  id: number;
  scenario: number;
  date: string;
  account: Account;
  account_id?: number;
  transfer_to_account?: Account | null;
  transfer_to_account_id?: number | null;
  description: string;
  category: Category | null;
  category_id?: number | null;
  direction: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ScenarioCategoryShock {
  id: number;
  scenario: number;
  category: Category;
  category_id?: number;
  percent_change: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioComparisonMetric {
  base: string | number | null;
  scenario: string | number | null;
  delta: string | null;
}

export interface ScenarioForecastChange {
  date: string | null;
  account_id: number | null;
  account_name: string;
  event: string;
  base_amount: string;
  scenario_amount: string;
  delta: string;
  effect_kind: "cash_flow" | "debt" | "savings" | "transfer_only";
  rule_id: number | null;
  is_recurring: boolean;
  source?: string | null;
}

export interface ScenarioForecastChangeGroup {
  event: string;
  account_id: number | null;
  account_name: string;
  rule_id: number | null;
  frequency: string;
  occurrence_count: number;
  delta_per_occurrence: string;
  total_delta: string;
  first_date: string | null;
  effect_kind: string;
  base_amount: string;
  scenario_amount: string;
}

export interface ScenarioRiskExplanation {
  is_risky: boolean;
  /** credit_only = change hits credit card only; cash checking unaffected */
  impact_scope?: "cash" | "credit_only" | "mixed";
  cash_lowest_unchanged?: boolean;
  first_problem_date: string | null;
  first_problem_account_id: number | null;
  first_problem_account_name: string | null;
  triggering_event: string | null;
  base_lowest_balance: string | null;
  base_lowest_balance_date: string | null;
  base_first_problem_date?: string | null;
  scenario_first_problem_date?: string | null;
  scenario_lowest_balance: string | null;
  scenario_lowest_balance_date: string | null;
  shortfall_amount: string | null;
  amount_needed_to_stay_safe: string | null;
  /** Sum of changed credit-card charge deltas (excludes interest). */
  traceable_credit_charge_delta?: string | null;
  traceable_occurrence_count?: number | null;
  traceable_per_occurrence?: string | null;
  traceable_event?: string | null;
  traceable_account_name?: string | null;
}

export interface ScenarioCreditUtilizationAtHorizon {
  account_id: number;
  account_name: string;
  base_balance_owed: string;
  scenario_balance_owed: string;
  base_utilization_percent: string;
  scenario_utilization_percent: string;
}

export interface ScenarioComparisonResponse {
  scenario_id: number;
  scenario_name: string;
  horizon: string;
  start_date: string;
  end_date: string;
  metrics: Record<string, ScenarioComparisonMetric>;
  summary: {
    overall: "better" | "worse" | "riskier" | "neutral";
    messages: string[];
  };
  forecast_changes?: ScenarioForecastChange[];
  forecast_change_groups?: ScenarioForecastChangeGroup[];
  risk_explanation?: ScenarioRiskExplanation;
  /** Credit card utilization at end of the forecast window (base vs scenario). */
  credit_utilization_at_horizon?: ScenarioCreditUtilizationAtHorizon[];
}

export interface ScenarioAffordabilityResult {
  affordable: boolean;
  lowest_projected_balance: string | null;
  lowest_projected_balance_date: string | null;
  safe_to_spend_after: string | null;
  base_lowest_projected_balance: string;
  amount: string;
  date: string;
  account_id: number;
  description: string;
}

/** Deterministic what-if transfer simulation (calendar drawer). */
export type TransferSimulationResultStatus = "resolved" | "partial" | "failed";

export interface ResolveRiskSimulationPreview {
  base_lowest_projected_balance?: string | null;
  simulated_lowest_projected_balance?: string | null;
  simulated_lowest_date?: string | null;
  risk_resolved?: boolean;
  result_status?: "resolved" | "partial" | "failed" | string;
  improvement_amount?: string | null;
  recovery_insight?: string | null;
  transfer_date?: string | null;
}

export interface ResolveRiskAction {
  id: string;
  kind: string;
  severity: string;
  title: string;
  why: string;
  recommended_action: string;
  priority_score: number;
  account_id?: number | null;
  related_account_id?: number | null;
  rule_id?: number | null;
  recommended_amount?: string | null;
  recommended_date?: string | null;
  primary_action_label?: string | null;
  primary_action_url?: string | null;
  primary_action_type?: string | null;
  simulation: ResolveRiskSimulationPreview;
}

export interface ResolveRiskSummary {
  account_id: number;
  account_name: string;
  forecast_days: number;
  risk_date: string | null;
  risk_date_label: string | null;
  lowest_projected_balance: string;
  minimum_buffer: string;
  available_to_spend: string | null;
  risk_status: string | null;
  headline: string;
}

export interface ResolveRiskPlan {
  eligible: boolean;
  account_id?: number;
  account_name?: string;
  message?: string;
  summary?: ResolveRiskSummary;
  actions?: ResolveRiskAction[];
  snooze_id?: string;
}

export interface TransferSimulationResult {
  from_account_id: number;
  to_account_id: number;
  amount: string;
  transfer_date: string;
  focus_date: string;
  result_status: TransferSimulationResultStatus;
  risk_resolved: boolean;
  base_lowest_projected_balance: string | null;
  simulated_lowest_projected_balance: string | null;
  horizon_lowest_projected_balance: string | null;
  horizon_lowest_date: string | null;
  base_horizon_lowest_date: string | null;
  base_next_risk_date: string | null;
  simulated_next_risk_date: string | null;
  safe_to_spend_after: string | null;
  base_safe_to_spend: string | null;
  recovery_date: string | null;
  recovery_days_until: number | null;
  recovery_description: string | null;
  recovery_is_payroll: boolean;
  recovery_insight: string;
  source_account_id: number;
  source_account_name: string;
  source_lowest_projected_balance: string | null;
  source_minimum_buffer: string;
  source_buffer_warning: boolean;
  to_account_name: string;
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
  /** Whether this transaction has been reconciled. */
  reconciled?: boolean;
  /** Running balance stored when this row was reconciled (signed; credit = negative debt). */
  reconciled_balance?: string | number | null;
  /** Raw Transaction.source (plaid, actual, rule, …). */
  txn_source?: string | null;
  import_match_status?: string | null;
  plaid_transaction_id?: string | null;
}

export interface TimelineResponse {
  timeline: TimelineRow[];
  account_summary: { account_id: number; account_name: string; ending_balance: string }[];
  /** When exclude_reconciled_past: opening balance for the unreconciled past ledger list. */
  past_opening_balance?: string;
}

export type TimelineCalendarRiskLevel = "none" | "watch" | "critical";

export interface TimelineCalendarTransaction {
  id: string | number | null;
  account_id?: number | null;
  description: string;
  account_name: string;
  amount: string | null;
  category: string | null;
  kind: string;
  source: string | null;
  /** Ledger row status (PLANNED, CLEARED, RECONCILED, …). */
  status?: string | null;
  rule_id?: number | null;
  transaction_id?: number | null;
  reconciled?: boolean;
  cleared?: boolean;
  balance_after: string | null;
  is_transfer: boolean;
}

/** Top cash-flow line items for a day (sorted by |amount|). */
export interface TimelineDayDriver {
  description: string;
  amount: string;
  kind: string;
  is_transfer?: boolean;
  account_name?: string;
}

/** When a stressed day is expected to recover (zero or buffer). */
export interface DayRecoveryInfo {
  recovery_date?: string | null;
  recovery_days_until?: number | null;
  recovery_target?: "zero" | "buffer" | null;
  recovery_description?: string | null;
  recovery_is_payroll?: boolean;
  recovery_balance?: string | null;
}

export interface TimelineCalendarDay extends DayLowestBalanceMarker, DayRecoveryInfo {
  date: string;
  income_total: string;
  expense_total: string;
  transfer_total: string;
  net_total: string;
  ending_balance: string;
  lowest_balance: string;
  risk_level: TimelineCalendarRiskLevel;
  risk_reason: string | null;
  has_risk: boolean;
  heat_level?: DayHeatLevel;
  heat_label?: string;
  heat_reason?: string | null;
  affected_account_name?: string | null;
  below_buffer_amount?: string | null;
  is_negative?: boolean;
  credit_balance_warnings?: CreditBalanceWarning[];
  biggest_drivers?: TimelineDayDriver[];
  transactions: TimelineCalendarTransaction[];
}

export interface TimelineCalendarRiskyAccount {
  account_id: number;
  account_name: string;
  lowest_projected_balance: string | null;
  risk_date: string | null;
  risk_status: string | null;
}

export interface TimelineCalendarSummary {
  lowest_balance: string | null;
  lowest_balance_date: string | null;
  next_risk_date: string | null;
  best_balance: string | null;
  best_balance_date: string | null;
  total_income: string;
  total_expenses: string;
  total_net: string;
  risky_accounts: TimelineCalendarRiskyAccount[];
}

export interface TimelineCalendarResponse {
  start_date: string;
  end_date: string;
  scenario_id: number | null;
  scenario_name: string | null;
  account_id: number | null;
  summary: TimelineCalendarSummary;
  days: TimelineCalendarDay[];
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
  /** Account is reconciled through today with no remaining unreconciled ledger rows. */
  all_reconciled_through_today?: boolean;
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
  latest_session_id?: number | null;
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
  transaction_count?: number;
  checked_transaction_ids: number[];
}

export interface ReconciliationSessionSummary {
  id: number;
  account_id: number;
  period_start_date: string | null;
  period_end_date: string | null;
  opening_balance: string;
  app_balance: string;
  bank_balance: string;
  difference: string;
  transaction_count: number;
  is_active: boolean;
  is_balanced: boolean;
  completed_at: string | null;
  completed_by: string | null;
  undone_at: string | null;
  undone_by: string | null;
  can_undo?: boolean;
}

export interface ReconciliationSessionDetail extends ReconciliationSessionSummary {
  account_name: string;
  transactions: Array<{
    id: number;
    date: string;
    payee: string;
    memo: string;
    category: string | null;
    amount: string;
    reconciled_balance: string | null;
    source: string;
  }>;
}

export interface ReconciliationSessionListResponse {
  results: ReconciliationSessionSummary[];
}

export interface ReconciliationUndoResponse {
  success: boolean;
  account_id: number;
  undone_session_id: number;
  transactions_unreconciled_count: number;
  new_last_reconciled_through: string | null;
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
