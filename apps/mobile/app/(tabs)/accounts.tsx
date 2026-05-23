import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View, FlatList } from "react-native";
import { formatCurrency, ACCOUNT_TYPE_LABELS } from "@budget-app/shared";
import { listAccounts } from "@budget-app/api-client";

export default function Accounts() {
  const { data } = useQuery({
    queryKey: ["accounts", "balance"],
    queryFn: () => listAccounts({ balance: "true" }),
  });
  const accounts = data?.results ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accounts</Text>
      <FlatList
        data={accounts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const isCredit = item.account_type === "CREDIT";
          const displayBalance = isCredit
            ? String(-parseFloat(item.balance ?? "0"))
            : (item.balance ?? "0");
          return (
            <View style={styles.card}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.type}>{ACCOUNT_TYPE_LABELS[item.account_type] ?? item.account_type}</Text>
              <Text style={[styles.balance, isCredit && styles.creditBalance]}>
                {formatCurrency(displayBalance, item.currency)}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  name: { fontSize: 16, fontWeight: "600" },
  type: { fontSize: 12, color: "#666", marginTop: 4 },
  balance: { fontSize: 18, fontWeight: "600", marginTop: 8 },
  creditBalance: { color: "#dc2626" },
});
