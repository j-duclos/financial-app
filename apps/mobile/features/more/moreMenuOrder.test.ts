import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const moreSource = readFileSync(join(dir, "MoreScreen.tsx"), "utf8");
const tabsLayout = readFileSync(join(dir, "../../app/(app)/(tabs)/_layout.tsx"), "utf8");

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("More screen information architecture", () => {
  it("uses Money tools → Planning → Insights & setup → Account", () => {
    const money = moreSource.indexOf('SectionHeader title="Money tools"');
    const planning = moreSource.indexOf('SectionHeader title="Planning"');
    const insights = moreSource.indexOf('SectionHeader title="Insights & setup"');
    const account = moreSource.indexOf('SectionHeader title="Account"');
    const logout = moreSource.indexOf('label="Log out"');
    expect(money).toBeGreaterThanOrEqual(0);
    expect(planning).toBeGreaterThan(money);
    expect(insights).toBeGreaterThan(planning);
    expect(account).toBeGreaterThan(insights);
    expect(logout).toBeGreaterThan(account);
    expect(moreSource).not.toMatch(/SectionHeader title="Setup"/);
    expect(moreSource).not.toMatch(/SectionHeader title="FlowSight"/);
  });

  it("places Automation first, then Action Center, then Recurring", () => {
    const moneyBlock = blockBetween(
      moreSource,
      "const MONEY_LINKS",
      "const PLANNING_LINKS"
    );
    expect(moneyBlock).toMatch(
      /title: "Automation"[\s\S]*title: "Action Center"[\s\S]*title: "Recurring"/
    );
    expect(moneyBlock).toMatch(/subtitle: "Create and manage recurring rules"/);
    expect(moneyBlock).toMatch(/subtitle: "Alerts and recommended actions"/);
    const automation = moreSource.indexOf('title: "Automation"');
    const actionCenter = moreSource.indexOf('title: "Action Center"');
    const recurring = moreSource.indexOf('title: "Recurring"');
    const profile = moreSource.indexOf('title: "Profile & Settings"');
    expect(automation).toBeGreaterThanOrEqual(0);
    expect(actionCenter).toBeGreaterThan(automation);
    expect(recurring).toBeGreaterThan(actionCenter);
    expect(profile).toBeGreaterThan(recurring);
  });

  it("keeps Profile & Settings in Account, below money and planning tools", () => {
    const accountBlock = moreSource.slice(moreSource.indexOf("const ACCOUNT_LINKS"));
    expect(accountBlock).toMatch(/title: "Profile & Settings"/);
    const moneyBlock = blockBetween(moreSource, "const MONEY_LINKS", "const PLANNING_LINKS");
    const planningBlock = blockBetween(
      moreSource,
      "const PLANNING_LINKS",
      "const INSIGHTS_SETUP_LINKS"
    );
    expect(moneyBlock).not.toMatch(/Profile & Settings/);
    expect(planningBlock).not.toMatch(/Profile & Settings/);
    expect(moreSource).toMatch(/title="Send feedback"/);
    expect(moreSource).toMatch(/title="FlowSight on the web"/);
    const profile = moreSource.indexOf('title: "Profile & Settings"');
    const feedback = moreSource.indexOf('title="Send feedback"');
    const web = moreSource.indexOf('title="FlowSight on the web"');
    expect(feedback).toBeGreaterThan(profile);
    expect(web).toBeGreaterThan(feedback);
  });

  it("does not change the bottom tab order", () => {
    expect(tabsLayout).toMatch(/title:\s*"Home"/);
    expect(tabsLayout).toMatch(/title:\s*"Transactions"/);
    expect(tabsLayout).toMatch(/title:\s*"Calendar"/);
    expect(tabsLayout).toMatch(/title:\s*"Accounts"/);
    expect(tabsLayout).toMatch(/title:\s*"More"/);
  });
});
