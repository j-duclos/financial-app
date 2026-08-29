import { transactionsForAccountPath } from "@/features/payment-planner/navigation";

export function goalsListPath(): "/goals" {
  return "/goals";
}

export function goalDetailPath(id: number): `/goal/${number}` {
  return `/goal/${id}`;
}

export function goalCreatePath(): "/goal/new" {
  return "/goal/new";
}

export function goalEditPath(id: number): `/goal/edit/${number}` {
  return `/goal/edit/${id}`;
}

export function goalContributionHistoryPath(id: number): `/goal/${number}/contributions` {
  return `/goal/${id}/contributions`;
}

export function goalRelatedTransactionsPath(accountId: number) {
  return transactionsForAccountPath(accountId);
}

export function goalAccountPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

export function goalWhatIfPath(goalId: number): {
  pathname: "/what-if";
  params: { goal: string };
} {
  return {
    pathname: "/what-if",
    params: { goal: String(goalId) },
  };
}
