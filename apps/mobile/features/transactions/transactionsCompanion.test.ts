import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@budget-app/shared";
import {
  MATCH_BANK_TRANSACTION_LABEL,
  MATCH_IMPORTED_TRANSACTION_LABEL,
  clampForecastDaysForPlan,
  isForecastDaysAllowed,
  transactionSourceDisplayLabel,
} from "@budget-app/shared";
import { TRANSACTIONS_LEDGER_PAGE_SIZE } from "./types";
import { needsTimelineProjection } from "./timelineProjection";
import { DEFAULT_TRANSACTION_FILTERS } from "./types";

const dir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

const listSource = read("features/transactions/TransactionsScreen.tsx");
const dataSource = read("features/transactions/useTransactionsData.ts");
const detailSource = read("features/transactions/TransactionDetailScreen.tsx");
const formSource = read("features/transactions/TransactionFormScreen.tsx");
const rowSource = read("features/transactions/TransactionRowCard.tsx");
const filtersSource = read("features/transactions/TransactionFiltersSheet.tsx");

const freeBilling: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  entitlements: {
    plan: "FREE",
    is_premium: false,
    plaid_bank_sync: false,
    payment_planner_full: false,
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 0,
      manual_accounts: 0,
      recurring_rules: 0,
      goals: 0,
    },
  },
};

const premiumBilling: BillingStatus = {
  ...freeBilling,
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  entitlements: {
    plan: "PREMIUM",
    is_premium: true,
    plaid_bank_sync: true,
    payment_planner_full: true,
    limits: {
      linked_institutions: null,
      manual_accounts: null,
      recurring_rules: null,
      operational_forecast_days: 365,
      goals: null,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 4,
      recurring_rules: 11,
      goals: 3,
    },
  },
};

describe("mobile Transactions companion list", () => {
  it("keeps the core ledger chrome", () => {
    expect(listSource).toMatch(/Transactions/);
    expect(listSource).toMatch(/AccountLedgerHeader/);
    expect(listSource).toMatch(/name="search"/);
    expect(listSource).toMatch(/Search active:/);
    expect(listSource).toMatch(/name="filter"/);
    expect(listSource).toMatch(/accessibilityLabel="Add transaction"/);
    expect(listSource).toMatch(/<FlatList/);
    expect(listSource).not.toMatch(/<ScrollView[\s\S]*data=\{listRows\}/);
  });

  it("paginates history and only fetches timeline when needed", () => {
    expect(TRANSACTIONS_LEDGER_PAGE_SIZE).toBeGreaterThan(1);
    expect(dataSource).toMatch(/useInfiniteQuery/);
    expect(dataSource).toMatch(/page_size: pageSize/);
    expect(dataSource).toMatch(/needsTimelineProjection/);
    expect(needsTimelineProjection({ ...DEFAULT_TRANSACTION_FILTERS, forecast: "posted" })).toBe(
      false
    );
    expect(needsTimelineProjection(DEFAULT_TRANSACTION_FILTERS)).toBe(true);
  });

  it("debounces search and keeps canonical history for header balances", () => {
    expect(dataSource).toMatch(/useDebouncedValue\(filters\.search, 350\)/);
    expect(dataSource).toMatch(/needsServerFilteredHistory/);
    expect(dataSource).toMatch(/canonicalHistoryQuery/);
    expect(dataSource).toMatch(/displayHistoryQuery/);
    expect(dataSource).toMatch(/headerCurrentFromLedger/);
    expect(dataSource).toMatch(/canonicalHistoryTransactions/);
  });

  it("preserves account selection and Balance After", () => {
    expect(listSource).toMatch(/rememberTransactionAccountSelection/);
    expect(listSource).toMatch(/clearTransactionFiltersPreservingAccount/);
    expect(rowSource).toMatch(/Bal \{formatCurrency\(runningBalance\)\}/);
  });

  it("does not copy desktop amount or reconcile controls onto the toolbar", () => {
    expect(listSource).not.toMatch(/amountMin/);
    expect(listSource).not.toMatch(/Show reconciled/);
    expect(filtersSource).toMatch(/amountMin/);
    expect(filtersSource).toMatch(/showReconciled/);
  });

  it("uses Add transaction for an unfiltered empty ledger", () => {
    expect(listSource).toMatch(/No transactions yet/);
    expect(listSource).toMatch(/Add a transaction to start tracking this account\./);
    expect(listSource).toMatch(/actionLabel=\{[\s\S]*"Add transaction"/);
  });
});

describe("mobile Transactions companion detail", () => {
  it("humanizes source labels and does not render raw enums", () => {
    expect(transactionSourceDisplayLabel({ source: "ACTUAL" })).toBe("Manual");
    expect(transactionSourceDisplayLabel({ source: "RULE" })).toBe("Recurring rule");
    expect(detailSource).toMatch(/transactionSourceDisplayLabel/);
    expect(detailSource).not.toMatch(/txn\.source \?\? "Manual"/);
  });

  it("places Match bank transaction in More overflow, not as a primary button", () => {
    expect(MATCH_BANK_TRANSACTION_LABEL).toBe("Match bank transaction");
    expect(MATCH_IMPORTED_TRANSACTION_LABEL).toBe("Match imported transaction");
    expect(detailSource).toMatch(/MATCH_BANK_TRANSACTION_LABEL/);
    expect(detailSource).toMatch(/accessibilityLabel="More actions"/);
    expect(detailSource).toMatch(/placement === "primary"/);
    expect(detailSource).toMatch(/placement === "overflow"/);
    expect(detailSource).not.toMatch(/variant="primary"[\s\S]{0,80}matchImport/);
    expect(detailSource).toMatch(
      /Choose the bank transaction that corresponds to this scheduled transaction/
    );
  });

  it("navigates linked transfer and recurring rule without prefetching the pair", () => {
    expect(detailSource).toMatch(/linkedTransactionDetailPath/);
    expect(detailSource).toMatch(/View paired transaction/);
    expect(detailSource).toMatch(/recurringRuleDetailPath/);
    expect(detailSource).not.toMatch(/getTransaction\(txn\.linked_transaction_id/);
  });
});

describe("mobile Transactions entitlements", () => {
  it("does not gate Add transaction on plan", () => {
    expect(listSource).not.toMatch(/atPlanLimit/);
    expect(listSource).not.toMatch(/useBillingStatus/);
    expect(formSource).not.toMatch(/atPlanLimit/);
    expect(formSource).not.toMatch(/useBillingStatus/);
    expect(formSource).not.toMatch(/is_premium/);
  });

  it("reuses the shared plan-aware forecast window", () => {
    expect(listSource).toMatch(/usePageForecastWindow/);
    expect(listSource).toMatch(/ForecastWindowOptionList/);
    expect(isForecastDaysAllowed(365, freeBilling)).toBe(false);
    expect(clampForecastDaysForPlan(365, freeBilling)).toBe(90);
    expect(isForecastDaysAllowed(365, premiumBilling)).toBe(true);
  });

  it("does not client-filter imported historical rows by plan", () => {
    expect(dataSource).not.toMatch(/is_premium/);
    expect(dataSource).not.toMatch(/plaid_bank_sync/);
    expect(dataSource).not.toMatch(/source !== "PLAID"/);
    expect(listSource).not.toMatch(/source !== "PLAID"/);
  });
});
