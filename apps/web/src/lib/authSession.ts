export const WEB_ACCESS_KEY = "budget_access";
export const WEB_REFRESH_KEY = "budget_refresh";

export function clearWebAuthStorage(): void {
  localStorage.removeItem(WEB_ACCESS_KEY);
  localStorage.removeItem(WEB_REFRESH_KEY);
}

export function resolveProtectedAuthGate(input: {
  loading: boolean;
  access: string | null;
}): "loading" | "login" | "app" {
  if (input.loading) return "loading";
  if (!input.access) return "login";
  return "app";
}
