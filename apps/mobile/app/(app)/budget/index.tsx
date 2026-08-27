import { Redirect } from "expo-router";

/** Legacy /budget deep link → Spending Limits (no longer a tab). */
export default function BudgetIndexRedirect() {
  return <Redirect href="/spending-limits" />;
}
