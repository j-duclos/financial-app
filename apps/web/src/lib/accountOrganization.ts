import {
  ACCOUNT_ROLE_LABELS,
  ACCOUNT_TYPE_LABELS,
  getEffectiveDisplayName,
  inferAccountRoleFromType,
} from "@budget-app/shared";
import type { Account, AccountRole, AccountType } from "@budget-app/shared";
import { getAccountRoleMeta } from "./accountRoles";
import { riskStatusLabel, showSafeToSpendForRole } from "./safeToSpendLabels";

export const ACCOUNT_ORG_STORAGE_KEY = "budget-app.accounts.organization.v1";

export type AccountGroupBy =
  | "type"
  | "role"
  | "institution"
  | "health"
  | "visibility"
  | "custom"
  | "none";

export type AccountSortBy =
  | "name_asc"
  | "name_desc"
  | "balance_high_low"
  | "balance_low_high"
  | "safe_to_spend_high_low"
  | "health_worst_first"
  | "utilization_high_low"
  | "institution"
  | "updated_recent"
  | "custom";

export type AccountLayoutMode = "compact" | "comfortable" | "detailed";

export type HealthStatus = "healthy" | "watch" | "risk" | "critical";

export type AccountLifecycleStatus = "active" | "archived" | "closed" | "deleted";

export interface AccountOrganizationFilters {
  riskOnly: boolean;
  /** @deprecated Use showArchived — when true without show* toggles, only active accounts */
  hideArchived: boolean;
  showArchived: boolean;
  showClosed: boolean;
  showDeleted: boolean;
  spendingOnly: boolean;
  debtOnly: boolean;
  forecastOnly: boolean;
  institutions: string[];
  roles: AccountRole[];
  healthStatuses: HealthStatus[];
}

export interface AccountOrganizationPreferences {
  groupBy: AccountGroupBy;
  sortBy: AccountSortBy;
  layoutMode: AccountLayoutMode;
  collapsedGroups: string[];
  filters: AccountOrganizationFilters;
  showGroupSummaries: boolean;
}

export interface AccountGroup {
  key: string;
  label: string;
  accounts: Account[];
}

export interface AccountGroupSummary {
  count: number;
  totalBalance: number;
  totalSafeToSpend: number;
  totalProjected: number;
  riskCount: number;
  totalDebt: number;
  avgUtilization: number | null;
  lowestProjected: number | null;
  currency: string;
}

const HEALTH_SEVERITY: Record<string, number> = {
  healthy: 0,
  watch: 1,
  risk: 2,
  critical: 3,
};

const ROLE_GROUP_ORDER: AccountRole[] = [
  "spending",
  "bills",
  "cash_reserve",
  "savings",
  "emergency_fund",
  "credit_card",
  "loan",
  "investment",
  "other",
];

const TYPE_GROUP_ORDER: AccountType[] = [
  "CHECKING",
  "SAVINGS",
  "CREDIT",
  "CASH",
  "INVESTMENT",
  "RETIREMENT_401K",
  "OTHER",
];

const HEALTH_GROUP_ORDER: HealthStatus[] = ["critical", "risk", "watch", "healthy"];

export const DEFAULT_ACCOUNT_ORG_PREFERENCES: AccountOrganizationPreferences = {
  groupBy: "role",
  sortBy: "health_worst_first",
  layoutMode: "comfortable",
  collapsedGroups: [],
  showGroupSummaries: true,
  filters: {
    riskOnly: false,
    hideArchived: true,
    showArchived: false,
    showClosed: false,
    showDeleted: false,
    spendingOnly: false,
    debtOnly: false,
    forecastOnly: false,
    institutions: [],
    roles: [],
    healthStatuses: [],
  },
};

export function accountRole(acc: Account): AccountRole {
  return acc.role ?? inferAccountRoleFromType(acc.account_type);
}

export function accountLifecycleStatus(acc: Account): AccountLifecycleStatus {
  if (acc.status) return acc.status;
  if (acc.archived === true) return "archived";
  if (acc.is_active === false) return "closed";
  return "active";
}

export function accountHealthStatus(acc: Account): HealthStatus {
  const s = (acc.health_status ?? acc.risk_status ?? "healthy") as HealthStatus;
  return HEALTH_SEVERITY[s] != null ? s : "healthy";
}

export function healthSeverity(acc: Account): number {
  return HEALTH_SEVERITY[accountHealthStatus(acc)] ?? 0;
}

export function isAtRisk(acc: Account): boolean {
  const s = accountHealthStatus(acc);
  return s === "risk" || s === "critical";
}

export function isDebtAccount(acc: Account): boolean {
  return acc.account_type === "CREDIT" || accountRole(acc) === "credit_card" || accountRole(acc) === "loan";
}

export function isSpendingAccount(acc: Account): boolean {
  const role = accountRole(acc);
  return role === "spending" || role === "bills" || role === "cash_reserve";
}

function parseAmount(value: string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Balance used for sorting and group totals (positive debt for credit). */
export function sortableBalance(acc: Account): number {
  if (acc.account_type === "CREDIT") {
    return parseAmount(acc.balance_owed ?? acc.current_balance);
  }
  return parseAmount(acc.available_balance ?? acc.balance);
}

export function displayBalance(acc: Account): number {
  return sortableBalance(acc);
}

export function loadAccountOrgPreferences(): AccountOrganizationPreferences {
  if (typeof window === "undefined") return DEFAULT_ACCOUNT_ORG_PREFERENCES;
  try {
    const raw = localStorage.getItem(ACCOUNT_ORG_STORAGE_KEY);
    if (!raw) return DEFAULT_ACCOUNT_ORG_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<AccountOrganizationPreferences>;
    return {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES,
      ...parsed,
      filters: {
        ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
        ...parsed.filters,
      },
      collapsedGroups: Array.isArray(parsed.collapsedGroups) ? parsed.collapsedGroups : [],
    };
  } catch {
    return DEFAULT_ACCOUNT_ORG_PREFERENCES;
  }
}

export function saveAccountOrgPreferences(prefs: AccountOrganizationPreferences): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCOUNT_ORG_STORAGE_KEY, JSON.stringify(prefs));
}

export function filterAccounts(
  accounts: Account[],
  filters: AccountOrganizationFilters
): Account[] {
  return accounts.filter((acc) => {
    const lifecycle = accountLifecycleStatus(acc);
    if (lifecycle !== "active") {
      if (lifecycle === "archived" && !filters.showArchived) return false;
      if (lifecycle === "closed" && !filters.showClosed) return false;
      if (lifecycle === "deleted" && !filters.showDeleted) return false;
    }
    if (filters.riskOnly && !isAtRisk(acc)) return false;
    if (filters.spendingOnly && !isSpendingAccount(acc)) return false;
    if (filters.debtOnly && !isDebtAccount(acc)) return false;
    if (filters.forecastOnly && acc.include_in_forecast === false) return false;
    if (filters.institutions.length > 0) {
      const inst = (acc.institution || "").trim() || "Unknown";
      if (!filters.institutions.includes(inst)) return false;
    }
    if (filters.roles.length > 0 && !filters.roles.includes(accountRole(acc))) return false;
    if (filters.healthStatuses.length > 0 && !filters.healthStatuses.includes(accountHealthStatus(acc))) {
      return false;
    }
    return true;
  });
}

function compareName(a: Account, b: Account): number {
  return getEffectiveDisplayName(a).localeCompare(getEffectiveDisplayName(b), undefined, {
    sensitivity: "base",
  });
}

export function sortAccounts(accounts: Account[], sortBy: AccountSortBy): Account[] {
  const list = [...accounts];
  const tieBreak = (a: Account, b: Account) => compareName(a, b);

  switch (sortBy) {
    case "name_asc":
      return list.sort(tieBreak);
    case "name_desc":
      return list.sort((a, b) => tieBreak(b, a));
    case "balance_high_low":
      return list.sort((a, b) => sortableBalance(b) - sortableBalance(a) || tieBreak(a, b));
    case "balance_low_high":
      return list.sort((a, b) => sortableBalance(a) - sortableBalance(b) || tieBreak(a, b));
    case "safe_to_spend_high_low":
      return list.sort((a, b) => {
        const av = showSafeToSpendForRole(accountRole(a), a.account_type)
          ? parseAmount(a.available_to_spend)
          : -Infinity;
        const bv = showSafeToSpendForRole(accountRole(b), b.account_type)
          ? parseAmount(b.available_to_spend)
          : -Infinity;
        return bv - av || tieBreak(a, b);
      });
    case "utilization_high_low":
      return list.sort(
        (a, b) =>
          parseAmount(b.utilization_percent) - parseAmount(a.utilization_percent) || tieBreak(a, b)
      );
    case "institution":
      return list.sort(
        (a, b) =>
          (a.institution || "").localeCompare(b.institution || "") || tieBreak(a, b)
      );
    case "updated_recent":
      return list.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime() || tieBreak(a, b)
      );
    case "custom":
      return list.sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0) || tieBreak(a, b)
      );
    case "health_worst_first":
    default:
      return list.sort(
        (a, b) => healthSeverity(b) - healthSeverity(a) || tieBreak(a, b)
      );
  }
}

function groupKeyForAccount(acc: Account, groupBy: AccountGroupBy): string {
  switch (groupBy) {
    case "type":
      return acc.account_type;
    case "role":
      return accountRole(acc);
    case "institution":
      return (acc.institution || "").trim() || "unknown";
    case "health":
      return accountHealthStatus(acc);
    case "visibility":
      return acc.include_in_forecast !== false ? "included" : "excluded";
    case "custom":
    case "none":
      return "all";
    default:
      return "all";
  }
}

function groupLabel(key: string, groupBy: AccountGroupBy): string {
  switch (groupBy) {
    case "type":
      return ACCOUNT_TYPE_LABELS[key] ?? key;
    case "role":
      return getAccountRoleMeta(key).label;
    case "institution":
      return key === "unknown" ? "Unknown institution" : key;
    case "health":
      return riskStatusLabel(key);
    case "visibility":
      return key === "included" ? "Included in forecasts" : "Excluded from forecasts";
    case "custom":
      return "Custom order";
    case "none":
      return "All accounts";
    default:
      return key;
  }
}

function groupSortIndex(key: string, groupBy: AccountGroupBy): number {
  switch (groupBy) {
    case "role": {
      const i = ROLE_GROUP_ORDER.indexOf(key as AccountRole);
      return i >= 0 ? i : 999;
    }
    case "type": {
      const i = TYPE_GROUP_ORDER.indexOf(key as AccountType);
      return i >= 0 ? i : 999;
    }
    case "health": {
      const i = HEALTH_GROUP_ORDER.indexOf(key as HealthStatus);
      return i >= 0 ? i : 999;
    }
    case "institution":
      return 0;
    case "visibility":
      return key === "included" ? 0 : 1;
    default:
      return 0;
  }
}

export function groupAccounts(
  accounts: Account[],
  groupBy: AccountGroupBy,
  sortBy: AccountSortBy
): AccountGroup[] {
  const sorted = sortAccounts(accounts, sortBy);
  if (groupBy === "none") {
    return [{ key: "all", label: groupLabel("all", "none"), accounts: sorted }];
  }

  const map = new Map<string, Account[]>();
  for (const acc of sorted) {
    const key = groupKeyForAccount(acc, groupBy);
    const bucket = map.get(key);
    if (bucket) bucket.push(acc);
    else map.set(key, [acc]);
  }

  const groups: AccountGroup[] = [...map.entries()].map(([key, accts]) => ({
    key,
    label: groupLabel(key, groupBy),
    accounts:
      groupBy === "custom" ? sortAccounts(accts, "custom") : accts,
  }));

  if (groupBy === "institution") {
    groups.sort((a, b) => a.label.localeCompare(b.label));
  } else if (groupBy !== "custom") {
    groups.sort((a, b) => {
      const ai = groupSortIndex(a.key, groupBy);
      const bi = groupSortIndex(b.key, groupBy);
      return ai - bi || a.label.localeCompare(b.label);
    });
  }

  return groups;
}

export function computeGroupSummary(accounts: Account[]): AccountGroupSummary {
  const currency = accounts[0]?.currency ?? "USD";
  let totalBalance = 0;
  let totalSafeToSpend = 0;
  let totalProjected = 0;
  let riskCount = 0;
  let totalDebt = 0;
  let utilSum = 0;
  let utilCount = 0;
  let lowestProjected: number | null = null;

  for (const acc of accounts) {
    if (acc.account_type === "CREDIT") {
      const owed = parseAmount(acc.balance_owed ?? acc.current_balance);
      totalDebt += owed;
      totalBalance += owed;
      const util = parseAmount(acc.utilization_percent);
      if (util > 0 || acc.utilization_percent != null) {
        utilSum += util;
        utilCount += 1;
      }
    } else {
      totalBalance += parseAmount(acc.available_balance ?? acc.balance);
    }

    if (showSafeToSpendForRole(accountRole(acc), acc.account_type)) {
      totalSafeToSpend += parseAmount(acc.available_to_spend);
    }

    totalProjected += parseAmount(acc.projected_balance_30_days);
    if (isAtRisk(acc)) riskCount += 1;

    const low = acc.lowest_projected_balance_30_days;
    if (low != null && low !== "") {
      const n = parseAmount(low);
      if (lowestProjected == null || n < lowestProjected) lowestProjected = n;
    }
  }

  return {
    count: accounts.length,
    totalBalance,
    totalSafeToSpend,
    totalProjected,
    riskCount,
    totalDebt,
    avgUtilization: utilCount > 0 ? utilSum / utilCount : null,
    lowestProjected,
    currency,
  };
}

/** Reorder global account list after moving one account within a group. */
export function reorderAccountsInGroup(
  allAccounts: Account[],
  groupAccountIds: number[],
  fromIndex: number,
  toIndex: number
): number[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return allAccounts.map((a) => a.id);
  }
  if (fromIndex >= groupAccountIds.length || toIndex >= groupAccountIds.length) {
    return allAccounts.map((a) => a.id);
  }

  const groupIds = [...groupAccountIds];
  const [moved] = groupIds.splice(fromIndex, 1);
  groupIds.splice(toIndex, 0, moved);

  const groupIdSet = new Set(groupAccountIds);
  const result: number[] = [];
  let groupQueue = [...groupIds];

  for (const acc of allAccounts) {
    if (groupIdSet.has(acc.id)) {
      const nextId = groupQueue.shift();
      if (nextId != null) result.push(nextId);
    } else {
      result.push(acc.id);
    }
  }
  return result;
}

export function uniqueInstitutions(accounts: Account[]): string[] {
  const set = new Set<string>();
  for (const acc of accounts) {
    set.add((acc.institution || "").trim() || "Unknown");
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export const GROUP_BY_OPTIONS: { value: AccountGroupBy; label: string }[] = [
  { value: "role", label: "Role" },
  { value: "type", label: "Account type" },
  { value: "institution", label: "Institution" },
  { value: "health", label: "Health status" },
  { value: "visibility", label: "Forecast inclusion" },
  { value: "custom", label: "Custom order" },
  { value: "none", label: "No grouping" },
];

export const SORT_BY_OPTIONS: { value: AccountSortBy; label: string }[] = [
  { value: "health_worst_first", label: "Health (worst first)" },
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "balance_high_low", label: "Balance (high → low)" },
  { value: "balance_low_high", label: "Balance (low → high)" },
  { value: "safe_to_spend_high_low", label: "Safe to spend (high → low)" },
  { value: "utilization_high_low", label: "Utilization (high → low)" },
  { value: "institution", label: "Institution" },
  { value: "updated_recent", label: "Recently updated" },
  { value: "custom", label: "Manual order" },
];

export const LAYOUT_MODE_OPTIONS: { value: AccountLayoutMode; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "detailed", label: "Detailed" },
];

export const HEALTH_FILTER_OPTIONS: { value: HealthStatus; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "risk", label: "At risk" },
  { value: "watch", label: "Watch" },
  { value: "healthy", label: "Healthy" },
];

export const ROLE_FILTER_OPTIONS = (
  Object.entries(ACCOUNT_ROLE_LABELS) as [AccountRole, string][]
).map(([value, label]) => ({ value, label }));
