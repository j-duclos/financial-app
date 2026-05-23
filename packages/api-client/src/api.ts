import type {
  Household,
  Account,
  AccountRelationship,
  AccountForecastSummary,
  SafeToSpendDashboard,
  Category,
  Transaction,
  Budget,
  MonthlySummary,
  CategoryBreakdownItem,
  AccountBalance,
  RecurringRule,
  Scenario,
  ScenarioRuleOverride,
  TimelineResponse,
  StatementTransaction,
  ReconciliationMatch,
  ReconcileSetupResponse,
  ReconcileCompleteResponse,
  UpcomingChargeNotification,
} from "@budget-app/shared";
import { request, requestRequired } from "./config";

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface RegisterBody {
  username: string;
  email?: string;
  password: string;
}

export interface TokenResponse {
  access: string;
  refresh: string;
  user?: { id: number; username: string };
  profile?: unknown;
}

export interface TransferCreateBody {
  from_account: number;
  to_account: number;
  amount: string;
  date: string;
  /** Payee/description for both legs (not overwritten by "Transfer"). */
  payee?: string;
  memo?: string;
  /** Category for the outgoing leg (e.g. Credit Card Payment). */
  from_category_id?: number | null;
}

export interface TransferResponse {
  transfer_id: string;
  from_transaction: Transaction;
  to_transaction: Transaction;
  amount: string;
  date: string;
  memo: string;
  created_at: string;
}

// Auth
export async function register(body: RegisterBody): Promise<TokenResponse & { user: { id: number; username: string }; profile: unknown }> {
  return requestRequired("/api/auth/register/", { method: "POST", body: JSON.stringify(body) });
}

export async function login(username: string, password: string): Promise<TokenResponse> {
  return requestRequired("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function refreshToken(refresh: string): Promise<{ access: string }> {
  return requestRequired("/api/auth/refresh/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}

// Profile
export async function getProfile(): Promise<{
  id: number;
  username: string;
  display_name: string;
  /** E.164 mobile stored for Plaid Link ``user.phone_number`` (SMS eligibility). */
  phone_e164?: string;
  default_household: number | null;
  default_account: number | null;
}> {
  return requestRequired("/api/profile/");
}

export async function updateProfile(data: {
  display_name?: string;
  phone_e164?: string | null;
  default_household?: number | null;
  default_account?: number | null;
}): Promise<unknown> {
  return requestRequired("/api/profile/", { method: "PATCH", body: JSON.stringify(data) });
}

export async function changePassword(body: {
  current_password: string;
  new_password: string;
  new_password_confirm: string;
}): Promise<{ detail: string }> {
  return requestRequired("/api/profile/change-password/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Households
export async function listHouseholds(): Promise<Household[]> {
  const p = await requestRequired<PaginatedResponse<Household>>("/api/households/", { params: { page_size: "100" } });
  return p.results;
}

export async function createHousehold(data: { name: string }): Promise<Household> {
  return requestRequired("/api/households/", { method: "POST", body: JSON.stringify(data) });
}

export async function getHousehold(id: number): Promise<Household> {
  return requestRequired(`/api/households/${id}/`);
}

export async function updateHousehold(id: number, data: Partial<Household>): Promise<Household> {
  return requestRequired(`/api/households/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteHousehold(id: number): Promise<void> {
  await request(`/api/households/${id}/`, { method: "DELETE" });
}

// Accounts (cache-bust so balances are never stale after transaction deletes)
export interface AccountLifecyclePreflight {
  action: string;
  account_id: number;
  balance: string;
  non_zero_balance: boolean;
  future_recurring_count: number;
  future_transfer_count: number;
  active_relationship_count: number;
  plaid_linked: boolean;
  plaid_sync_enabled: boolean;
  warnings: string[];
}

export async function listAccounts(params?: {
  household?: number;
  balance?: string;
  forecast_summary?: string;
  health?: string;
  days?: number;
  page_size?: number;
  status?: string;
  active_only?: boolean;
  include_archived?: boolean;
  include_closed?: boolean;
  include_deleted?: boolean;
}): Promise<PaginatedResponse<Account>> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.balance === "true") q.balance = "true";
  if (params?.forecast_summary === "true") q.forecast_summary = "true";
  if (params?.health === "true") q.health = "true";
  if (params?.days != null) q.days = String(params.days);
  if (params?.page_size != null) q.page_size = String(params.page_size);
  if (params?.status) q.status = params.status;
  if (params?.active_only) q.active_only = "true";
  if (params?.include_archived) q.include_archived = "true";
  if (params?.include_closed) q.include_closed = "true";
  if (params?.include_deleted) q.include_deleted = "true";
  q._ = String(Date.now());
  return requestRequired("/api/accounts/", { params: q });
}

export async function createAccount(data: {
  household: number;
  account_type: string;
  name: string;
  display_name?: string | null;
  purpose?: string | null;
  notes?: string | null;
  /** @deprecated Use display_name */
  nickname?: string | null;
  institution?: string;
  /** Four digits; matches Plaid mask when linking — avoids duplicate accounts from name mismatch. */
  last_four?: string | null;
  currency?: string;
  starting_balance?: string | null;
  apr?: string | null;
  interest_rate?: string | null;
  interest_cycle_end_day?: number | null;
  credit_limit?: string | null;
  billing_cycle_end_day?: number | null;
  statement_closing_day?: number | null;
  payment_due_day?: number | null;
  current_balance?: string | null;
  statement_balance?: string | null;
  minimum_payment_amount?: string | null;
  autopay_enabled?: boolean;
  autopay_account?: number | null;
  autopay_type?: string;
  autopay_fixed_amount?: string | null;
  promotional_apr?: string | null;
  promotional_end_date?: string | null;
  preserve_partner_transfer_legs?: boolean;
}): Promise<Account> {
  return requestRequired("/api/accounts/", { method: "POST", body: JSON.stringify(data) });
}

export async function getAccount(
  id: number,
  balance = false,
  options?: { forecast_summary?: boolean; health?: boolean; days?: number; relationships?: boolean }
): Promise<Account> {
  const params: Record<string, string> = {};
  if (balance) params.balance = "true";
  if (options?.forecast_summary) params.forecast_summary = "true";
  if (options?.health) params.health = "true";
  if (options?.relationships) params.relationships = "true";
  if (options?.days != null) params.days = String(options.days);
  if (Object.keys(params).length > 0) params._ = String(Date.now());
  return requestRequired(`/api/accounts/${id}/`, { params: Object.keys(params).length > 0 ? params : undefined });
}

export async function listAccountRelationships(params?: {
  household?: number;
  account?: number;
  is_active?: boolean;
}): Promise<AccountRelationship[]> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.account != null) q.account = String(params.account);
  if (params?.is_active != null) q.is_active = params.is_active ? "true" : "false";
  const p = await requestRequired<PaginatedResponse<AccountRelationship>>(
    "/api/accounts/relationships/",
    { params: Object.keys(q).length ? q : undefined }
  );
  return p.results;
}

export async function createAccountRelationship(data: {
  source_account: number;
  destination_account: number;
  relationship_type: string;
  default_amount?: string | null;
  default_day?: number | null;
  frequency?: string;
  is_active?: boolean;
  notes?: string;
}): Promise<AccountRelationship> {
  return requestRequired("/api/accounts/relationships/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAccountRelationship(
  id: number,
  data: Partial<AccountRelationship>
): Promise<AccountRelationship> {
  return requestRequired(`/api/accounts/relationships/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deactivateAccountRelationship(
  id: number
): Promise<AccountRelationship> {
  return requestRequired(`/api/accounts/relationships/${id}/deactivate/`, { method: "POST" });
}

export async function deleteAccountRelationship(id: number): Promise<void> {
  await request(`/api/accounts/relationships/${id}/`, { method: "DELETE" });
}

export async function updateAccount(id: number, data: Partial<Account>): Promise<Account> {
  return requestRequired(`/api/accounts/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Soft-delete account (preserves transaction history). */
export async function deleteAccount(id: number): Promise<void> {
  await request(`/api/accounts/${id}/`, { method: "DELETE" });
}

export async function getAccountLifecyclePreflight(
  id: number,
  action: "archive" | "close" | "delete" | "restore"
): Promise<AccountLifecyclePreflight> {
  return requestRequired(`/api/accounts/${id}/lifecycle-preflight/`, {
    params: { action },
  });
}

export async function archiveAccount(
  id: number,
  body?: { reason?: string; preserve_recurring?: boolean }
): Promise<Account> {
  return requestRequired(`/api/accounts/${id}/archive/`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function closeAccount(
  id: number,
  body?: { reason?: string; closed_at?: string; force?: boolean }
): Promise<Account> {
  return requestRequired(`/api/accounts/${id}/close/`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function restoreAccount(
  id: number,
  body?: { target_status?: string; reenable_plaid?: boolean; reenable_forecast?: boolean }
): Promise<Account> {
  return requestRequired(`/api/accounts/${id}/restore/`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

/** Set display order of accounts. Pass IDs in the order you want (first = top). */
export async function reorderAccounts(accountIds: number[]): Promise<{ detail: string; account_ids: number[] }> {
  return requestRequired("/api/accounts/reorder/", {
    method: "POST",
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

/** Delete phantom transaction(s) on an account by amount (e.g. 3100). Uses same DB as running backend. */
export async function clearPhantom(accountId: number, amount: string): Promise<{ detail: string; deleted: number }> {
  return requestRequired(`/api/accounts/${accountId}/clear_phantom/`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

/** Count manual / rule-shadow rows without a Plaid id (optional inclusive date range). */
export async function clearManualTransactionsPreview(
  accountId: number,
  params?: { before?: string; after?: string }
): Promise<{ eligible_count: number }> {
  const q: Record<string, string> = {};
  if (params?.before) q.before = params.before;
  if (params?.after) q.after = params.after;
  return requestRequired(`/api/accounts/${accountId}/clear-manual-transactions/`, {
    params: Object.keys(q).length ? q : undefined,
  });
}

/** Delete those rows (keeps bank-imported Plaid lines). Requires confirm: true. */
export async function clearManualTransactions(
  accountId: number,
  options: { confirm: true; before?: string; after?: string }
): Promise<{ deleted: number; detail: string }> {
  return requestRequired(`/api/accounts/${accountId}/clear-manual-transactions/`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

/** Count transactions and reconcile statement lines before wiping an account ledger. */
export async function clearAllAccountTransactionsPreview(accountId: number): Promise<{
  transaction_count: number;
  statement_lines: number;
}> {
  return requestRequired(`/api/accounts/${accountId}/clear-all-transactions/`);
}

/** Delete every transaction on the account (and related transfer legs / statement imports). */
export async function clearAllAccountTransactions(
  accountId: number,
  options: { confirm: true }
): Promise<{
  detail: string;
  transactions_deleted: number;
  statement_lines_deleted: number;
  plaid_items_cursor_reset?: number;
}> {
  return requestRequired(`/api/accounts/${accountId}/clear-all-transactions/`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

/** After wiping local data, use this if Plaid Import returns nothing (replays history from empty cursor). */
export async function resetPlaidItemSyncCursor(itemId: number): Promise<{ detail: string }> {
  return requestRequired(`/api/plaid/items/${itemId}/reset-sync-cursor/`, { method: "POST" });
}

/** Payoff projection for CREDIT accounts: months to pay off with fixed monthly payment. */
export interface PayoffProjection {
  months_to_payoff: number;
  total_interest: string;
  payoff_date: string | null;
  current_balance: string;
}
export async function getAccountPayoff(
  accountId: number,
  monthlyPayment: number | string
): Promise<PayoffProjection> {
  return requestRequired(`/api/accounts/${accountId}/payoff/`, {
    params: { monthly_payment: String(monthlyPayment) },
  });
}

export async function getAccountAvailableToSpend(
  accountId: number,
  days = 30
): Promise<AccountForecastSummary> {
  return requestRequired(`/api/accounts/${accountId}/available-to-spend/`, {
    params: { days: String(days) },
  });
}

export async function getAccountsForecastSummary(params?: {
  household?: number;
  days?: number;
}): Promise<{ days: number; accounts: Array<AccountForecastSummary & { account_id: number }> }> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.days != null) q.days = String(params.days);
  return requestRequired("/api/accounts/forecast-summary/", { params: Object.keys(q).length ? q : undefined });
}

export async function getSafeToSpendDashboard(params?: {
  household?: number;
  days?: number;
}): Promise<SafeToSpendDashboard> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.days != null) q.days = String(params.days);
  return requestRequired("/api/accounts/safe-to-spend-dashboard/", {
    params: Object.keys(q).length ? q : undefined,
  });
}

export async function getAccountsHealth(params?: {
  household?: number;
  days?: number;
}): Promise<{
  days: number;
  accounts: Array<{
    account_id: number;
    health_status: string;
    health_score: number;
    health_reason: string | null;
    health_risk_date: string | null;
    health_details: Record<string, unknown>;
    health_recommended_action: string | null;
  }>;
  accounts_needing_attention_count: number;
  critical_accounts_count: number;
  next_health_risk_date: string | null;
  next_health_issue_text: string | null;
}> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.days != null) q.days = String(params.days);
  return requestRequired("/api/accounts/health/", {
    params: Object.keys(q).length ? q : undefined,
  });
}

// Categories
export async function listCategories(params?: {
  household?: number;
  type?: "INCOME" | "EXPENSE";
  include_archived?: boolean;
  page_size?: number;
}): Promise<PaginatedResponse<Category>> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.type) q.category_type = params.type;
  if (params?.include_archived === true) q.include_archived = "true";
  if (params?.page_size != null) q.page_size = String(params.page_size);
  return requestRequired("/api/categories/", {
    params: Object.keys(q).length ? q : undefined,
  });
}

export async function createCategory(data: {
  household: number;
  name: string;
  category_type: string;
  parent?: number | null;
  sort_order?: number;
}): Promise<Category> {
  return requestRequired("/api/categories/", { method: "POST", body: JSON.stringify(data) });
}

export async function getCategory(id: number): Promise<Category> {
  return requestRequired(`/api/categories/${id}/`);
}

export async function updateCategory(id: number, data: Partial<Category>): Promise<Category> {
  return requestRequired(`/api/categories/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Deletes category or archives if referenced by transactions/budgets. */
export async function deleteCategory(id: number): Promise<void> {
  await request(`/api/categories/${id}/`, { method: "DELETE" });
}

// Transactions
export async function listTransactions(params?: {
  account?: number;
  category?: number;
  date_after?: string;
  date_before?: string;
  page?: number;
  page_size?: number;
}): Promise<PaginatedResponse<Transaction>> {
  const q: Record<string, string> = {};
  if (params?.account != null) q.account = String(params.account);
  if (params?.category != null) q.category = String(params.category);
  if (params?.date_after) q.date_after = params.date_after;
  if (params?.date_before) q.date_before = params.date_before;
  if (params?.page != null) q.page = String(params.page);
  if (params?.page_size != null) q.page_size = String(params.page_size);
  q._ = String(Date.now());
  return requestRequired("/api/transactions/", { params: q });
}

export async function createTransaction(data: {
  account_id: number;
  date: string;
  payee: string;
  amount: string;
  category_id?: number | null;
  memo?: string;
  cleared?: boolean;
  tags?: string[];
}): Promise<Transaction> {
  return requestRequired("/api/transactions/", { method: "POST", body: JSON.stringify(data) });
}

export async function getTransaction(id: number): Promise<Transaction> {
  return requestRequired(`/api/transactions/${id}/`);
}

export async function updateTransaction(id: number, data: Partial<Transaction>): Promise<Transaction> {
  return requestRequired(`/api/transactions/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteTransaction(id: number): Promise<void> {
  await request(`/api/transactions/${id}/`, { method: "DELETE" });
}

/** Bulk-remove future rows left when a recurring rule was deleted (source=rule, no rule link). */
export async function cleanupOrphanedRuleRows(): Promise<{ deleted: number }> {
  return requestRequired("/api/transactions/cleanup-orphaned-rule-rows/", { method: "POST" });
}

// Plaid
export interface PlaidMeta {
  plaid_env: string;
  plaid_configured: boolean;
  oauth_institutions_url: string;
  /** Plaid log error INSTITUTION_REGISTRATION_REQUIRED → open this. */
  oauth_institution_status_url: string;
  plaid_dashboard_home: string;
  redirect_uris_url: string;
  troubleshooting_url: string;
}

export async function getPlaidMeta(): Promise<PlaidMeta> {
  return requestRequired("/api/plaid/meta/", {});
}

export interface PlaidLinkedAccountRow {
  id: number;
  plaid_account_id: string;
  /** Last digits for the account from Plaid (e.g. card/checking suffix). */
  mask?: string;
  account_id: number;
  account_name: string;
}

export interface PlaidItem {
  id: number;
  household: number;
  item_id: string;
  institution_id: string;
  institution_name: string;
  linked_accounts: PlaidLinkedAccountRow[];
  created_at: string;
  updated_at: string;
}

export async function createPlaidLinkToken(
  householdId: number,
  options?: { phone_number?: string; redirect_uri?: string }
): Promise<{ link_token: string }> {
  const body: Record<string, unknown> = { household_id: householdId };
  if (options?.phone_number != null && String(options.phone_number).trim() !== "") {
    body.phone_number = String(options.phone_number).trim();
  }
  if (options?.redirect_uri != null && String(options.redirect_uri).trim() !== "") {
    body.redirect_uri = String(options.redirect_uri).trim();
  }
  return requestRequired("/api/plaid/link-token/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function exchangePlaidPublicToken(body: {
  public_token: string;
  household_id: number;
}): Promise<PlaidItem> {
  return requestRequired("/api/plaid/exchange/", { method: "POST", body: JSON.stringify(body) });
}

export async function listPlaidItems(params?: {
  household?: number;
  page_size?: number;
}): Promise<PaginatedResponse<PlaidItem>> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.page_size != null) q.page_size = String(params.page_size);
  return requestRequired("/api/plaid/items/", { params: Object.keys(q).length ? q : undefined });
}

export async function syncPlaidItem(
  itemId: number
): Promise<{ added: number; modified: number; removed: number; merged?: number }> {
  return requestRequired(`/api/plaid/items/${itemId}/sync/`, { method: "POST" });
}

export async function deletePlaidItem(itemId: number): Promise<void> {
  await request(`/api/plaid/items/${itemId}/`, { method: "DELETE" });
}

// Transfers
export async function createTransfer(body: TransferCreateBody): Promise<TransferResponse> {
  return requestRequired("/api/transactions/transfers/", { method: "POST", body: JSON.stringify(body) });
}

// Budgets
export async function listBudgets(params?: { household?: number; year?: number; month?: number }): Promise<PaginatedResponse<Budget>> {
  const q: Record<string, string> = {};
  if (params?.household != null) q.household = String(params.household);
  if (params?.year != null) q.year = String(params.year);
  if (params?.month != null) q.month = String(params.month);
  return requestRequired("/api/budgets/", { params: q });
}

export async function createBudget(data: {
  household: number;
  category: number;
  year: number;
  month: number;
  planned_amount?: string;
}): Promise<Budget> {
  return requestRequired("/api/budgets/", { method: "POST", body: JSON.stringify(data) });
}

export async function getBudget(id: number): Promise<Budget> {
  return requestRequired(`/api/budgets/${id}/`);
}

export async function updateBudget(id: number, data: Partial<Budget>): Promise<Budget> {
  return requestRequired(`/api/budgets/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteBudget(id: number): Promise<void> {
  await request(`/api/budgets/${id}/`, { method: "DELETE" });
}

// Insights
export async function getMonthlySummary(month: string): Promise<MonthlySummary> {
  return requestRequired("/api/insights/monthly-summary/", { params: { month } });
}

export async function getCategoryBreakdown(month: string): Promise<{ month: string; breakdown: CategoryBreakdownItem[] }> {
  return requestRequired("/api/insights/category-breakdown/", { params: { month } });
}

export async function getAccountBalances(): Promise<{ balances: AccountBalance[] }> {
  return requestRequired("/api/insights/account-balances/");
}

// Rules (RecurringRule)
export async function listRules(): Promise<PaginatedResponse<RecurringRule>> {
  return requestRequired("/api/rules/", { params: { page_size: "200" } });
}

export async function createRule(data: {
  household: number;
  name: string;
  account_id: number;
  transfer_to_account_id?: number | null;
  category_id?: number | null;
  direction: string;
  amount: string;
  currency?: string;
  frequency: string;
  interval?: number;
  day_of_week?: number | null;
  day_of_month?: number | null;
  nth_week?: number | null;
  start_date: string;
  end_date?: string | null;
  active?: boolean;
  notes?: string | null;
}): Promise<RecurringRule> {
  return requestRequired("/api/rules/", { method: "POST", body: JSON.stringify(data) });
}

export async function getRule(id: number): Promise<RecurringRule> {
  return requestRequired(`/api/rules/${id}/`);
}

export async function updateRule(id: number, data: Partial<RecurringRule>): Promise<RecurringRule> {
  return requestRequired(`/api/rules/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteRule(id: number): Promise<void> {
  await request(`/api/rules/${id}/`, { method: "DELETE" });
}

// Scenarios
export async function listScenarios(): Promise<PaginatedResponse<Scenario>> {
  return requestRequired("/api/scenarios/", { params: { page_size: "100" } });
}

export async function createScenario(data: { household: number; name: string }): Promise<Scenario> {
  return requestRequired("/api/scenarios/", { method: "POST", body: JSON.stringify(data) });
}

export async function getScenario(id: number): Promise<Scenario> {
  return requestRequired(`/api/scenarios/${id}/`);
}

export async function updateScenario(id: number, data: Partial<Scenario>): Promise<Scenario> {
  return requestRequired(`/api/scenarios/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteScenario(id: number): Promise<void> {
  await request(`/api/scenarios/${id}/`, { method: "DELETE" });
}

export async function listScenarioOverrides(scenarioId: number): Promise<ScenarioRuleOverride[]> {
  return requestRequired(`/api/scenarios/${scenarioId}/overrides/`);
}

export async function createScenarioOverride(
  scenarioId: number,
  data: { rule_id: number; override_amount?: string | null; override_active?: boolean | null; override_start_date?: string | null; override_end_date?: string | null; override_account_id?: number | null; override_category_id?: number | null }
): Promise<ScenarioRuleOverride> {
  return requestRequired(`/api/scenarios/${scenarioId}/overrides/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateScenarioOverride(id: number, data: Partial<ScenarioRuleOverride>): Promise<ScenarioRuleOverride> {
  return requestRequired(`/api/scenario-overrides/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteScenarioOverride(id: number): Promise<void> {
  await request(`/api/scenario-overrides/${id}/`, { method: "DELETE" });
}

// Upcoming charge notifications (1 day before a rule charge is due)
export async function listUpcomingChargeNotifications(params?: {
  unread_only?: boolean;
  page_size?: number;
}): Promise<PaginatedResponse<UpcomingChargeNotification>> {
  const q: Record<string, string> = { page_size: String(params?.page_size ?? 50) };
  if (params?.unread_only) q.unread_only = "true";
  return requestRequired("/api/notifications/", { params: q });
}

export async function markUpcomingChargeNotificationRead(id: number): Promise<UpcomingChargeNotification> {
  return requestRequired(`/api/notifications/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ read: true }),
  });
}

// Timeline (cache-bust so balances/transactions are never stale after deletes)
export async function getTimeline(params: {
  start?: string;
  end?: string;
  as_of?: string;
  horizon?: "3m" | "6m" | "12m" | "18m" | "24m" | "36m";
  scenario_id?: number | null;
  account_id?: number | null;
  household_id?: number | null;
}): Promise<TimelineResponse> {
  const q: Record<string, string> = {};
  if (params.start) q.start = params.start;
  if (params.end) q.end = params.end;
  if (params.as_of) q.as_of = params.as_of;
  if (params.horizon) q.horizon = params.horizon;
  if (params.scenario_id != null) q.scenario_id = String(params.scenario_id);
  if (params.account_id != null) q.account_id = String(params.account_id);
  if (params.household_id != null) q.household_id = String(params.household_id);
  q._ = String(Date.now());
  return requestRequired("/api/timeline/", { params: q });
}

// Reconcile
export async function reconcileImportCsv(accountId: number, file: File): Promise<{ imported: number; rows: StatementTransaction[] }> {
  const { getAuthHeader, getBaseUrl, ApiError } = await import("./config");
  const formData = new FormData();
  formData.append("account_id", String(accountId));
  formData.append("file", file);
  const headers: Record<string, string> = {};
  const auth = getAuthHeader?.();
  if (auth?.Authorization) headers.Authorization = auth.Authorization;
  const res = await fetch(getBaseUrl() + "/api/reconcile/import_csv/", {
    method: "POST",
    body: formData,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      detail = text;
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export async function getReconcileSuggestions(params: {
  account_id: number;
  start: string;
  end: string;
}): Promise<{ suggestions: { statement_transaction: StatementTransaction; suggested_matches: { id: number; date: string; payee: string; amount: string; category: string | null }[] }[] }> {
  return requestRequired("/api/reconcile/suggestions/", { params });
}

export async function reconcileMatch(body: {
  statement_txn_id: number;
  matched_transaction_id?: number | null;
  status?: "MATCHED" | "UNMATCHED";
}): Promise<ReconciliationMatch> {
  return requestRequired("/api/reconcile/match/", { method: "POST", body: JSON.stringify(body) });
}

export async function getReconcileUnmatched(params?: { account_id?: number }): Promise<{ unmatched_statement: StatementTransaction[] }> {
  const q: Record<string, string> = {};
  if (params?.account_id != null) q.account_id = String(params.account_id);
  return requestRequired("/api/reconcile/unmatched/", { params: Object.keys(q).length ? q : undefined });
}

export async function getReconcileSetup(
  accountId: number,
  params?: { start?: string; end?: string },
): Promise<ReconcileSetupResponse> {
  const q: Record<string, string> = { account_id: String(accountId) };
  if (params?.start) q.start = params.start;
  if (params?.end) q.end = params.end;
  return requestRequired("/api/reconcile/setup/", { params: q });
}

export async function completeReconciliation(body: {
  account_id: number;
  bank_current_balance: string;
  checked_transaction_ids: number[];
  period_start_date: string;
  period_end_date: string;
}): Promise<ReconcileCompleteResponse> {
  return requestRequired("/api/reconcile/complete/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
