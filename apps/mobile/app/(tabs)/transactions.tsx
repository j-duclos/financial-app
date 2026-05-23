import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View, FlatList } from "react-native";
import { formatCurrency, currentMonthStr } from "@budget-app/shared";
import { listTransactions } from "@budget-app/api-client";

export default function Transactions() {
  const [month] = useState(currentMonthStr());
  const [y, m] = month.split("-").map(Number);
  const dateAfter = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const dateBefore = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;

  const { data } = useQuery({
    queryKey: ["transactions", dateAfter, dateBefore],
    queryFn: () => listTransactions({ date_after: dateAfter, date_before: dateBefore }),
  });
  const transactions = data?.results ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transactions</Text>
      <FlatList
        data={transactions}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.payee}>{item.payee}</Text>
              <Text style={styles.date}>{item.date}</Text>
            </View>
            <Text style={[styles.amount, item.direction === "INFLOW" ? styles.inflow : styles.outflow]}>
              {item.direction === "INFLOW" ? "+" : ""}{formatCurrency(item.amount)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  payee: { fontSize: 16, fontWeight: "500" },
  date: { fontSize: 12, color: "#666", marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "600" },
  inflow: { color: "green" },
  outflow: { color: "red" },
});
