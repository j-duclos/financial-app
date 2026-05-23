import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { formatCurrency, currentMonthStr } from "@budget-app/shared";
import { getAccountBalances, getMonthlySummary } from "@budget-app/api-client";

export default function Dashboard() {
  const month = currentMonthStr();
  const { data: balances } = useQuery({
    queryKey: ["account-balances"],
    queryFn: () => getAccountBalances(),
  });
  const { data: summary } = useQuery({
    queryKey: ["monthly-summary", month],
    queryFn: () => getMonthlySummary(month),
  });

  const netWorth = balances?.balances?.reduce((s, b) => s + parseFloat(b.balance), 0) ?? 0;
  const income = summary ? parseFloat(summary.total_income) : 0;
  const expenses = summary ? Math.abs(parseFloat(summary.total_expenses)) : 0;
  const net = summary ? parseFloat(summary.net) : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Net worth</Text>
        <Text style={styles.value}>{formatCurrency(netWorth)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Income (MTD)</Text>
        <Text style={[styles.value, { color: "green" }]}>{formatCurrency(income)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Expenses (MTD)</Text>
        <Text style={[styles.value, { color: "red" }]}>{formatCurrency(expenses)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Net (MTD)</Text>
        <Text style={[styles.value, { color: net >= 0 ? "green" : "red" }]}>{formatCurrency(net)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  card: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  label: { fontSize: 12, color: "#666", marginBottom: 4 },
  value: { fontSize: 20, fontWeight: "600" },
});
