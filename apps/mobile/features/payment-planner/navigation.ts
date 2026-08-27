/** Deep links from Payment Planner to related screens. */
export function accountDetailPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

export function transactionsForAccountPath(
  accountId: number,
  accountName?: string
): {
  pathname: "/(app)/(tabs)/transactions";
  params: { account: string; accountName?: string };
} {
  return {
    pathname: "/(app)/(tabs)/transactions",
    params: {
      account: String(accountId),
      ...(accountName ? { accountName } : {}),
    },
  };
}

export function planDetailsPath(): "/payment-planner/plan-details" {
  return "/payment-planner/plan-details";
}
