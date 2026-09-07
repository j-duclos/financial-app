import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_DETAIL_PREVIEW_LIMIT } from "./queryKeys";
import { transactionsForAccountPath } from "@/features/payment-planner/navigation";
import { paymentPlannerAccountPath } from "@/features/dashboard/navigation";

const dir = dirname(fileURLToPath(import.meta.url));
const accountsSource = readFileSync(join(dir, "AccountsScreen.tsx"), "utf8");
const accountDetailSource = readFileSync(join(dir, "AccountDetailScreen.tsx"), "utf8");
const accountRow = readFileSync(join(dir, "AccountRow.tsx"), "utf8");
const accountForm = readFileSync(join(dir, "AccountFormScreen.tsx"), "utf8");
const listHook = readFileSync(join(dir, "useAccountsList.ts"), "utf8");
const detailQueries = readFileSync(join(dir, "accountDetailQueries.ts"), "utf8");
const moreSource = readFileSync(join(dir, "../more/MoreScreen.tsx"), "utf8");
const webQuickActions = readFileSync(
  join(dir, "../../../web/src/lib/accountQuickActions.ts"),
  "utf8"
);

describe("mobile Accounts list companion UX", () => {
  it("keeps type grouping and compact credit rows without portfolio cards", () => {
    expect(accountsSource).toMatch(/groupAccountsByType/);
    expect(accountsSource).not.toMatch(/Portfolio Summary|Net Position|Total Debt/);
    expect(accountRow).not.toMatch(/Portfolio Summary|Net Position|Total Debt/);
    expect(accountRow).not.toMatch(/Payment Planner/);
    expect(accountRow).not.toMatch(/useQuery/);
    expect(accountRow).not.toMatch(/getAccount\(/);
    expect(accountRow).not.toMatch(/listTransactions/);
    expect(accountRow).toMatch(/Avail/);
    expect(accountRow).toMatch(/Utilization/);
    expect(accountRow).toMatch(/Above your/);
    expect(accountRow).toMatch(/router\.push\(`\/account\/\$\{account\.id\}`\)|onPress/);
  });

  it("preserves Free manual-account limit interception and Premium unlimited usage", () => {
    expect(accountsSource).toMatch(/atPlanLimit\(billing, "manual_accounts"\)/);
    expect(accountsSource).toMatch(/manualAccountUsageLabel/);
    expect(accountsSource).toMatch(/manualAccountLimitReachedMessage/);
    expect(accountsSource).toMatch(/PLAID_PREMIUM_MESSAGE/);
    expect(accountsSource).toMatch(/isPremium/);
    expect(accountsSource).toMatch(/No accounts yet/);
    expect(accountsSource).toMatch(/Add your first account to start tracking balances and transactions/);
    expect(accountsSource).toMatch(/Connect banks from the web app/);
  });
});

describe("mobile Account Detail companion UX", () => {
  it("removes Reconcile from mobile while leaving web Reconcile intact", () => {
    expect(accountDetailSource).not.toMatch(/Reconcile account/);
    expect(accountDetailSource).not.toMatch(/reconcilePath/);
    expect(moreSource).not.toMatch(/title: "Reconcile"/);
    expect(moreSource).not.toMatch(/href: "\/reconcile"/);
    expect(webQuickActions).toMatch(/label: "Reconcile"/);
  });

  it("replaces Safe to spend with Current / After pending / Lowest projected", () => {
    expect(accountDetailSource).not.toMatch(/Safe to spend/);
    expect(accountDetailSource).toMatch(/After pending/);
    expect(accountDetailSource).toMatch(/Lowest projected/);
    expect(accountDetailSource).toMatch(/lowestProjected/);
    expect(accountDetailSource).not.toMatch(/getAccount\([^)]*lowest/);
  });

  it("shows Payment Planner only for credit accounts on detail, not list rows", () => {
    expect(accountDetailSource).toMatch(/Payment Planner/);
    expect(accountDetailSource).toMatch(/account_type === "CREDIT"/);
    expect(accountDetailSource).toMatch(/paymentPlannerAccountPath\(account\.id\)/);
    expect(accountRow).not.toMatch(/Payment Planner/);
    expect(paymentPlannerAccountPath(9)).toEqual({
      pathname: "/payment-planner",
      params: { account: "9" },
    });
  });

  it("keeps View ledger primary and reduces duplicate full-ledger buttons", () => {
    expect(accountDetailSource).toMatch(/label="View ledger"/);
    expect(accountDetailSource).not.toMatch(/View full ledger/);
    expect(accountDetailSource).toMatch(/See all/);
    expect(accountDetailSource).toMatch(/rememberTransactionAccountSelection\(account\.id\)/);
    expect(transactionsForAccountPath(7, "360 Checking")).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: expect.objectContaining({ account: "7", accountName: "360 Checking" }),
    });
  });

  it("keeps bounded Upcoming and Recent previews without a full history query", () => {
    expect(ACCOUNT_DETAIL_PREVIEW_LIMIT).toBe(5);
    expect(accountDetailSource).toMatch(/page_size: ACCOUNT_DETAIL_PREVIEW_LIMIT/);
    expect(accountDetailSource).toMatch(/accountDetailUpcomingPreviewRows/);
    expect(accountDetailSource).toMatch(/defaultLedgerTimelineQueryOptions/);
    expect(accountDetailSource).not.toMatch(/TRANSACTIONS_LEDGER_PAGE_SIZE/);
    expect(accountDetailSource).not.toMatch(/date_after: today/);
  });

  it("keeps Edit behind existing form permissions and does not imply synced-balance override", () => {
    expect(accountDetailSource).toMatch(/\/account\/edit\/\$\{account\.id\}/);
    expect(accountForm).toMatch(/plaid_item_id/);
    expect(accountForm).toMatch(/synced balances from the bank/);
    expect(accountForm).toMatch(/!isEdit \?/);
    expect(accountForm).toMatch(/Starting balance/);
  });

  it("does not reproduce desktop Resolve Risk on list rows", () => {
    expect(accountRow).not.toMatch(/Resolve Risk|Resolve risk/);
    expect(accountDetailSource).not.toMatch(/Resolve Risk/);
    expect(accountDetailSource).toMatch(/View in ledger/);
  });
});

describe("Accounts query architecture", () => {
  it("keeps staged cache seeding and does not add a lowest-projected-only API", () => {
    expect(accountDetailSource).toMatch(/seedAccountFromListCache/);
    expect(accountDetailSource).toMatch(/fetchEnrichedAccountDetail/);
    expect(accountDetailSource).toMatch(/usePageForecastWindow/);
    expect(detailQueries).toMatch(/forecast_summary: true/);
    expect(detailQueries).not.toMatch(/lowest_projected/);
    expect(listHook).toMatch(/listAccounts/);
    expect(listHook).not.toMatch(/getAccount\(/);
  });

  it("keeps account-summary enrichment and timeline preview as distinct required calls", () => {
    expect(accountDetailSource).toMatch(/fetchEnrichedAccountDetail/);
    expect(accountDetailSource).toMatch(/defaultLedgerTimelineQueryOptions/);
    expect(accountDetailSource).toMatch(/row-level pending\/forecast events/);
  });
});
