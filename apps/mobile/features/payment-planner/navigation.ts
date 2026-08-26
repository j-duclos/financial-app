/** Deep links from Payment Planner to related screens. */
export function accountDetailPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

export function transactionsForAccountPath(accountId: number): {
  pathname: "/(app)/(tabs)/transactions";
  params: { account: string };
} {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: { account: String(accountId) },
  };
}

export function planDetailsPath(): "/payment-planner/plan-details" {
  return "/payment-planner/plan-details";
}
