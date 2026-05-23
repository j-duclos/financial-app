import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryType } from "@budget-app/shared";
import {
  listCategories,
  listHouseholds,
  createCategory,
  updateCategory,
  getProfile,
} from "@budget-app/api-client";

export default function Categories() {
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [formName, setFormName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const householdId = profile?.default_household ?? households?.[0]?.id;

  const { data: categoriesData, isLoading } = useQuery({
    queryKey: ["categories", { household: householdId, type }],
    queryFn: () =>
      listCategories({ household: householdId!, type, page_size: 500 }),
    enabled: !!householdId,
  });

  const categories = categoriesData?.results ?? [];
  const filtered = search.trim()
    ? categories.filter((c) =>
        c.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : categories;

  const createMu = useMutation({
    mutationFn: (body: { household: number; name: string; category_type: string }) =>
      createCategory(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setAdding(false);
      setFormName("");
      setSubmitError(null);
    },
    onError: (err) => setSubmitError(err.message || "Failed to create category"),
  });

  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Category> }) =>
      updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setEditing(null);
      setFormName("");
      setSubmitError(null);
    },
    onError: (err) => setSubmitError(err.message || "Failed to update category"),
  });

  function openEdit(cat: Category) {
    setEditing(cat);
    setAdding(false);
    setFormName(cat.name);
    setSubmitError(null);
  }

  function openAdd() {
    setEditing(null);
    setAdding(true);
    setFormName("");
    setSubmitError(null);
  }

  function handleSave() {
    const trimmed = formName.trim();
    if (trimmed.length < 2) {
      setSubmitError("Name must be at least 2 characters.");
      return;
    }
    if (editing) {
      updateMu.mutate({ id: editing.id, data: { name: trimmed } });
    } else if (householdId) {
      createMu.mutate({
        household: householdId,
        name: trimmed,
        category_type: type,
      });
    }
  }

  function handleArchive(cat: Category) {
    updateMu.mutate({
      id: cat.id,
      data: { is_archived: !cat.is_archived },
    });
    setEditing(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Categories</Text>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, type === "EXPENSE" && styles.tabActive]}
          onPress={() => setType("EXPENSE")}
        >
          <Text style={[styles.tabText, type === "EXPENSE" && styles.tabTextActive]}>
            Expense
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, type === "INCOME" && styles.tabActive]}
          onPress={() => setType("INCOME")}
        >
          <Text style={[styles.tabText, type === "INCOME" && styles.tabTextActive]}>
            Income
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search categories…"
        value={search}
        onChangeText={setSearch}
      />

      {isLoading ? (
        <ActivityIndicator size="large" style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, item.is_archived && styles.cardArchived]}
              onPress={() => openEdit(item)}
              activeOpacity={0.7}
            >
              <Text style={[styles.name, item.is_archived && styles.textArchived]}>
                {item.name}
              </Text>
              {item.is_system && (
                <Text style={styles.badge}>Default</Text>
              )}
              {item.is_archived && (
                <Text style={[styles.badge, styles.badgeArchived]}>Archived</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={openAdd}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {(editing || adding) && (
        <Modal visible transparent animationType="slide">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => { setEditing(null); setAdding(false); }}
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing ? "Edit category" : "Add category"}</Text>
            {submitError && (
              <Text style={styles.error}>{submitError}</Text>
            )}
            <TextInput
              style={styles.input}
              value={formName}
              onChangeText={setFormName}
              placeholder="Category name"
              autoFocus
            />
            {editing && (
              <TouchableOpacity
                style={styles.archiveBtn}
                onPress={() => handleArchive(editing)}
              >
                <Text style={styles.archiveBtnText}>
                  {editing.is_archived ? "Restore" : "Archive"}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setEditing(null); setAdding(false); }}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSave}
                disabled={createMu.isPending || updateMu.isPending}
              >
                <Text style={styles.saveBtnText}>
                  {createMu.isPending || updateMu.isPending ? "Saving…" : editing ? "Save" : "Add"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 16 },
  tabs: {
    flexDirection: "row",
    marginBottom: 12,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  tabActive: { backgroundColor: "#2f95dc" },
  tabText: { fontSize: 14, fontWeight: "500", color: "#333" },
  tabTextActive: { color: "#fff" },
  search: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    fontSize: 16,
  },
  list: { paddingBottom: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  cardArchived: { opacity: 0.8 },
  name: { fontSize: 16, fontWeight: "600", flex: 1 },
  textArchived: { textDecorationLine: "line-through", color: "#888" },
  badge: {
    fontSize: 11,
    color: "#666",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeArchived: { color: "#b45309", backgroundColor: "#fef3c7" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
  },
  sheetTitle: { fontSize: 18, fontWeight: "600", marginBottom: 16 },
  error: { color: "#dc2626", fontSize: 14, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  archiveBtn: {
    paddingVertical: 12,
    marginBottom: 16,
  },
  archiveBtnText: { color: "#2f95dc", fontSize: 16 },
  sheetActions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#2f95dc",
    borderRadius: 8,
  },
  saveBtnText: { color: "#fff", fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2f95dc",
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: { fontSize: 28, color: "#fff", fontWeight: "300", lineHeight: 32 },
});
