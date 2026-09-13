import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  hasOfficialHomeBalances,
  hasVisibleHomeAccountBalances,
  isHomeFullScreenLoading,
  isHomePrimaryContentVisible,
  isHomeRefetchingWithData,
  isHomeSectionPending,
  shouldShowHomeAccountBalancesSection,
  shouldShowHomeFirstRun,
  shouldStartHomeAccountsQuery,
  shouldStartHomeSummaryFast,
} from "./homeReadiness";

function cashAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Checking",
    institution: "Bank",
    currency: "USD",
    account_type: "CHECKING",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    balance: "1200.00",
    available_balance: "1200.00",
    ...overrides,
  } as Account;
}

describe("homeReadiness", () => {
  it("never blanks the entire Home screen for onboarding, summary-fast, timeline, or isFetching", () => {
    expect(
      isHomeFullScreenLoading({
        onboardingPending: true,
        summaryFastPending: true,
        timelinePending: true,
        isFetching: true,
      })
    ).toBe(false);
  });

  it("treats only missing data as a section pending state, not isFetching", () => {
    expect(isHomeSectionPending(false)).toBe(true);
    expect(isHomeSectionPending(true)).toBe(false);
    expect(isHomeRefetchingWithData(true, true)).toBe(true);
    expect(isHomeRefetchingWithData(true, false)).toBe(false);
    expect(isHomeRefetchingWithData(false, true)).toBe(false);
  });

  it("starts accounts and summary-fast as soon as the user is authenticated", () => {
    expect(shouldStartHomeAccountsQuery(true)).toBe(true);
    expect(shouldStartHomeSummaryFast(true)).toBe(true);
    expect(shouldStartHomeAccountsQuery(false)).toBe(false);
    expect(shouldStartHomeSummaryFast(false)).toBe(false);
  });

  it("does not show first-run while onboarding is still pending", () => {
    expect(shouldShowHomeFirstRun({ onboardingPending: true, missingAccounts: false })).toBe(false);
    expect(shouldShowHomeFirstRun({ onboardingPending: false, missingAccounts: true })).toBe(true);
    expect(shouldShowHomeFirstRun({ onboardingPending: false, missingAccounts: false })).toBe(false);
  });

  it("shows account balances without waiting for timeline or summary-fast", () => {
    const accounts = [cashAccount()];
    expect(hasVisibleHomeAccountBalances(accounts)).toBe(true);
    expect(
      shouldShowHomeAccountBalancesSection({
        firstRun: false,
        accountsPending: false,
        accounts,
      })
    ).toBe(true);
    expect(
      isHomePrimaryContentVisible({
        accountsWithVisibleBalance: true,
        officialTopSummary: false,
      })
    ).toBe(true);
  });

  it("does not mark primary content from mount or empty fetching state", () => {
    expect(
      isHomePrimaryContentVisible({
        accountsWithVisibleBalance: false,
        officialTopSummary: false,
      })
    ).toBe(false);
    expect(hasOfficialHomeBalances(null)).toBe(false);
    expect(hasOfficialHomeBalances({ liquid_cash: "10.00", available_credit: "0" })).toBe(true);
  });
});
