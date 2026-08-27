export function reconcilePath(accountId?: number): "/reconcile" | { pathname: "/reconcile"; params: { account: string } } {
  if (accountId == null) return "/reconcile";
  return { pathname: "/reconcile", params: { account: String(accountId) } };
}

export function reconcileSessionDetailPath(sessionId: number): `/reconcile/session/${number}` {
  return `/reconcile/session/${sessionId}`;
}

export function transactionDetailPath(id: number): `/transaction/${number}` {
  return `/transaction/${id}`;
}
