import { ACCOUNT_TYPE_LABELS, getEffectiveDisplayName, type Account } from "@budget-app/shared";

export type AccountGroup = {
  key: string;
  label: string;
  accounts: Account[];
};

const TYPE_GROUP_ORDER = ["CHECKING", "SAVINGS", "CREDIT", "CASH", "INVESTMENT", "RETIREMENT_401K", "OTHER"];

function sortByName(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) =>
    getEffectiveDisplayName(a).localeCompare(getEffectiveDisplayName(b), undefined, {
      sensitivity: "base",
      numeric: true,
    })
  );
}

/** Group active accounts by account type (matches web default grouping semantics). */
export function groupAccountsByType(accounts: Account[]): AccountGroup[] {
  const active = accounts.filter((a) => (a.status ?? "active") === "active" && !a.deleted_at);
  const map = new Map<string, Account[]>();
  for (const acc of active) {
    const key = acc.account_type;
    const bucket = map.get(key);
    if (bucket) bucket.push(acc);
    else map.set(key, [acc]);
  }

  const groups: AccountGroup[] = [];
  for (const key of TYPE_GROUP_ORDER) {
    const accts = map.get(key);
    if (accts?.length) {
      groups.push({
        key,
        label: ACCOUNT_TYPE_LABELS[key] ?? key,
        accounts: sortByName(accts),
      });
      map.delete(key);
    }
  }
  for (const [key, accts] of map.entries()) {
    groups.push({
      key,
      label: ACCOUNT_TYPE_LABELS[key] ?? key,
      accounts: sortByName(accts),
    });
  }
  return groups;
}

export function accountLifecycleStatus(acc: Account): "active" | "archived" | "closed" | "deleted" {
  if (acc.status) return acc.status;
  if (acc.deleted_at) return "deleted";
  if (acc.archived === true) return "archived";
  if (acc.is_active === false) return "closed";
  return "active";
}
