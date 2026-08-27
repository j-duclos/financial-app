import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const accountsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "AccountsScreen.tsx"),
  "utf8"
);
const accountDetailSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "AccountDetailScreen.tsx"),
  "utf8"
);
const appHeaderSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../components/ui/AppHeader.tsx"),
  "utf8"
);
const stackNavSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../lib/navigateStackBack.ts"),
  "utf8"
);
const dashboardNavSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../dashboard/navigation.ts"),
  "utf8"
);
const tabsIndexSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/(tabs)/index.tsx"),
  "utf8"
);

describe("Accounts screen navigation", () => {
  it("uses AppHeader with visible Back and preserved Add account action", () => {
    expect(accountsSource).toMatch(/<AppHeader/);
    expect(accountsSource).toMatch(/showBack/);
    expect(accountsSource).toMatch(/title="Accounts"/);
    expect(accountsSource).toMatch(/accessibilityLabel="Add account"/);
    expect(accountsSource).toMatch(/router\.push\("\/account\/new"\)/);
    expect(accountsSource).not.toMatch(/typography\.title.*Accounts/);
  });

  it("keeps attention filter controls separate from navigation", () => {
    expect(accountsSource).toMatch(/Needs attention/);
    expect(accountsSource).toMatch(/Clear filter/);
    expect(accountsSource).toMatch(/router\.replace\("\/accounts"\)/);
  });

  it("routes to account detail without resetting the list screen", () => {
    expect(accountsSource).toMatch(/router\.push\(`\/account\/\$\{account\.id\}`\)/);
  });
});

describe("Stack back helper", () => {
  it("prefers router.back when history exists and falls back to More", () => {
    expect(stackNavSource).toMatch(/navigation\.canGoBack\(\)/);
    expect(stackNavSource).toMatch(/router\.back\(\)/);
    expect(stackNavSource).toMatch(/SECONDARY_SCREEN_BACK_FALLBACK.*=.*"\/more"/);
    expect(stackNavSource).toMatch(/router\.replace\(fallbackHref\)/);
  });

  it("does not hard-code Home as the fallback destination", () => {
    expect(stackNavSource).not.toMatch(/replace\("\/\(app\)\/\(tabs\)"\)/);
    expect(stackNavSource).not.toMatch(/replace\("\/"\)/);
  });
});

describe("AppHeader back affordance", () => {
  it("labels Back for accessibility and supports showBack", () => {
    expect(appHeaderSource).toMatch(/accessibilityLabel="Back"/);
    expect(appHeaderSource).toMatch(/showBack/);
    expect(appHeaderSource).toMatch(/useStackBack/);
    expect(appHeaderSource).toMatch(/< Back/);
  });
});

describe("Dashboard attention filter navigation", () => {
  it("pushes Accounts with attention param from Home", () => {
    expect(dashboardNavSource).toMatch(/pathname: "\/accounts"/);
    expect(dashboardNavSource).toMatch(/attention: "1"/);
  });
});

describe("Tab root screens", () => {
  it("does not add AppHeader back to Home tab root", () => {
    expect(tabsIndexSource).not.toMatch(/AppHeader/);
    expect(tabsIndexSource).not.toMatch(/showBack/);
  });
});

describe("Account detail navigation", () => {
  it("uses stack back from account detail", () => {
    expect(accountDetailSource).toMatch(/onBack=\{\(\) => router\.back\(\)\}/);
  });
});
