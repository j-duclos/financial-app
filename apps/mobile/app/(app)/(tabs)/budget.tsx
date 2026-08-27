import { Redirect } from "expo-router";

/** Hidden legacy tab route — Budget moved to More → Spending Limits. */
export default function BudgetTabRedirect() {
  return <Redirect href="/spending-limits" />;
}
