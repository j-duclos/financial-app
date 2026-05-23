import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View, FlatList } from "react-native";
import { formatCurrency, formatMonth, currentMonthStr } from "@budget-app/shared";
import { listBudgets, listCategories, getCategoryBreakdown } from "@budget-app/api-client";

export default function Budget() {
  const [month] = useState(currentMonthStr());
  const [y, m] = month.split("-").map(Number);

  const { data: budgetsData } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => listBudgets({ year: y, month: m }),
  });
  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories({ page_size: 500 }),
  });
  const { data: breakdownData } = useQuery({
    queryKey: ["category-breakdown", month],
    queryFn: () => getCategoryBreakdown(month),
  });

  const budgets = budgetsData?.results ?? [];
  const categories = categoriesData?.results ?? [];
  const breakdown = breakdownData?.breakdown ?? [];
  const breakdownByCat = new Map(breakdown.map((b) => [b.category_id, parseFloat(b.total)]));
  const budgetByCat = new Map(budgets.map((b) => [b.category.id, b]));
  const expenseCategories = categories.filter((c) => c.category_type === "EXPENSE" && c.parent);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Budget</Text>
      <Text style={styles.month}>{formatMonth(y, m)}</Text>
      <FlatList
        data={expenseCategories}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const planned = budgetByCat.get(item.id);
          const plannedAmt = planned ? parseFloat(planned.planned_amount) : 0;
          const spent = Math.abs(breakdownByCat.get(item.id) ?? 0);
          const remaining = plannedAmt - spent;
          return (
            <View style={styles.card}>
              <Text style={styles.name}>{item.name}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Planned:</Text>
                <Text>{formatCurrency(plannedAmt)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Spent:</Text>
                <Text style={styles.red}>{formatCurrency(spent)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Remaining:</Text>
                <Text style={remaining >= 0 ? styles.green : styles.red}>{formatCurrency(remaining)}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  month: { fontSize: 14, color: "#666", marginBottom: 16 },
  card: { backgroundColor: "#fff", padding: 16, borderRadius: 8, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  name: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  label: { color: "#666" },
  red: { color: "red" },
  green: { color: "green" },
});
