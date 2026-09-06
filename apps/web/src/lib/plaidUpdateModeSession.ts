const TOKEN_KEY = "budget-app.plaid.update_link_token";
const ITEM_KEY = "budget-app.plaid.update_item_id";

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function persistPendingUpdateMode(token: string, itemId: number): void {
  write(TOKEN_KEY, token);
  write(ITEM_KEY, String(itemId));
}

export function readPendingUpdateMode(): { token: string; itemId: number } | null {
  const token = read(TOKEN_KEY);
  const rawId = read(ITEM_KEY);
  const itemId = rawId ? Number(rawId) : NaN;
  if (!token || !Number.isInteger(itemId) || itemId < 1) return null;
  return { token, itemId };
}

export function clearPendingUpdateMode(): void {
  remove(TOKEN_KEY);
  remove(ITEM_KEY);
}
