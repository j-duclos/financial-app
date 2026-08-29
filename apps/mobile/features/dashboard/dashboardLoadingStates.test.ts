import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(dir, "DashboardScreen.tsx"), "utf8");
const detailsSource = readFileSync(join(dir, "DashboardDetailsSections.tsx"), "utf8");
const attentionCardSource = readFileSync(join(dir, "DashboardAttentionCard.tsx"), "utf8");
const prefetchSource = readFileSync(join(dir, "attentionPrefetch.ts"), "utf8");
const transactionsSource = readFileSync(
  join(dir, "../transactions/TransactionsScreen.tsx"),
  "utf8"
);

describe("Dashboard loading states", () => {
  it("uses three-state section model instead of inferring empty from missing details", () => {
    expect(dashboardSource).toMatch(/dashboardDetailsSectionState/);
    expect(dashboardSource).toMatch(/sectionState=\{upcomingSectionState\}/);
    expect(dashboardSource).toMatch(/sectionState=\{goalsSectionState\}/);
    expect(dashboardSource).not.toMatch(/loading=\{upcomingLoading\}/);
  });

  it("does not show upcoming empty state while details is unresolved", () => {
    expect(detailsSource).toMatch(/sectionState === "loading"/);
    expect(detailsSource).toMatch(/UpcomingPreviewSkeleton/);
    expect(detailsSource).toMatch(
      /sectionState === "error"[\s\S]*preview\.transactions\.length === 0/
    );
  });

  it("does not show goals empty state while details is unresolved", () => {
    expect(detailsSource).toMatch(/GoalCardSkeleton/);
    expect(detailsSource).toMatch(/sectionState === "loading"/);
    expect(detailsSource).toMatch(/sectionState === "error"[\s\S]*goals\.length === 0/);
  });

  it("preserves cached dashboard during background refresh", () => {
    expect(dashboardSource).toMatch(/placeholderData: keepPreviousData/);
    expect(dashboardSource).toMatch(/fastLoading && !summaryFast/);
    expect(dashboardSource).toMatch(/recalculating && !!details/);
  });

  it("shows attention skeletons before summary-fast resolves", () => {
    const attentionSource = readFileSync(join(dir, "AttentionRequiredSection.tsx"), "utf8");
    expect(attentionSource).toMatch(/AttentionRowsSkeleton/);
    expect(dashboardSource).toMatch(/loading=\{attentionLoading\}/);
  });
});

describe("Attention navigation and prefetch", () => {
  it("navigates immediately without awaiting destination API", () => {
    expect(attentionCardSource).toMatch(/markAttentionNavigation\("attention-tap"\)/);
    expect(attentionCardSource).toMatch(/router\.push\(attentionCardTapDestination/);
    expect(attentionCardSource).not.toMatch(/await.*router\.push/);
    expect(attentionCardSource).not.toMatch(/prefetch/);
  });

  it("prefetches priority Transactions ledgers with canonical list + timeline keys", () => {
    expect(prefetchSource).toMatch(/transactionQueryKeys\.list|defaultLedgerHistoryQueryOptions|prefetchDefaultLedgerQueries/);
    expect(prefetchSource).toMatch(/prefetchHomeTransactionsDestinations|prefetchDefaultLedgerQueries/);
    expect(prefetchSource).toMatch(/selectHomeTransactionsPrefetchAccountIds/);
    expect(prefetchSource).toMatch(/attentionCardOpensLedger/);
  });

  it("does not prefetch enriched credit account details", () => {
    expect(prefetchSource).not.toMatch(/getAccount/);
    expect(prefetchSource).not.toMatch(/forecast_summary/);
  });

  it("does not surface prefetch failures on Home", () => {
    expect(dashboardSource).toMatch(/\.catch\(\(\) => undefined\)/);
    expect(dashboardSource).not.toMatch(/prefetch.*ErrorState/);
  });

  it("prefetches only after Home is fully useful and after interactions", () => {
    expect(dashboardSource).toMatch(/prefetchHomeTransactionsDestinations/);
    expect(dashboardSource).toMatch(/isHomeReadyForTransactionsPrefetch/);
    expect(dashboardSource).toMatch(/InteractionManager\.runAfterInteractions/);
    expect(dashboardSource).toMatch(/home-fully-useful/);
    expect(dashboardSource).not.toMatch(/extendedSettled/);
    expect(dashboardSource).not.toMatch(/prefetchVisibleAttentionDestinations\(queryClient, attention\)/);
  });

  it("passes account name to transactions deep link for immediate ledger context", () => {
    const navigationSource = readFileSync(join(dir, "navigation.ts"), "utf8");
    expect(navigationSource).toMatch(
      /transactionsForAccountPath\(item\.account_id, item\.account_name\)/
    );
    expect(transactionsSource).toMatch(/AccountSelectorSheet/);
    expect(transactionsSource).toMatch(/selectedAccountName/);
  });

  it("does not block transactions on household profile when account deep link is present", () => {
    expect(transactionsSource).toMatch(/!householdReady && !hasAccountDeepLink/);
  });
});

describe("Dashboard query key alignment", () => {
  it("reuses Transactions default ledger prefetch helpers", () => {
    expect(prefetchSource).toMatch(/prefetchDefaultLedgerQueries/);
    expect(prefetchSource).toMatch(/DEFAULT_TRANSACTION_FILTERS|defaultLedger/);
  });
});
