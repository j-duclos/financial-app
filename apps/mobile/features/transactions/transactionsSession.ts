/** In-memory session: last account viewed on Transactions (current app session only). */
let lastViewedAccountId: number | null = null;

export function getLastViewedTransactionAccountId(): number | null {
  return lastViewedAccountId;
}

export function setLastViewedTransactionAccountId(accountId: number): void {
  lastViewedAccountId = accountId;
}

export function clearLastViewedTransactionAccountId(): void {
  lastViewedAccountId = null;
}
