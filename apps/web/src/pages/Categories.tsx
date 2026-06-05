import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryType } from "@budget-app/shared";
import {
  listCategories,
  listHouseholds,
  createCategory,
  updateCategory,
  deleteCategory,
  getProfile,
} from "@budget-app/api-client";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";

function groupByParent(categories: Category[]): Map<number | null, Category[]> {
  const map = new Map<number | null, Category[]>();
  for (const c of categories) {
    const key = c.parent ?? null;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export default function Categories() {
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; parent: number | null; is_archived: boolean }>({ name: "", parent: null, is_archived: false });
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const householdId = profile?.default_household ?? households?.[0]?.id;

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", { household: householdId, type, include_archived: showArchived }],
    queryFn: () =>
      listCategories({
        household: householdId!,
        type,
        include_archived: showArchived,
        page_size: 500,
      }),
    enabled: !!householdId,
  });

  const categories = categoriesData?.results ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  const grouped = useMemo(() => groupByParent(filtered), [filtered]);
  const displayList = useMemo(() => {
    const roots = grouped.get(null) ?? [];
    const children = [...grouped.entries()]
      .filter(([key]) => key !== null)
      .flatMap(([, list]) => list);
    return [...roots, ...children].sort((a, b) => a.name.localeCompare(b.name));
  }, [grouped]);

  const createMu = useMutation({
    mutationFn: (body: { household: number; name: string; category_type: string; parent?: number | null }) =>
      createCategory(body),
    onMutate: async (vars) => {
      const qk = ["categories", { household: householdId, type, include_archived: showArchived }];
      await queryClient.cancelQueries({ queryKey: ["categories"] });
      const prev = queryClient.getQueryData(qk);
      queryClient.setQueryData(qk, (old: { results: Category[] } | undefined) =>
        old
          ? {
              ...old,
              results: [
                ...old.results,
                { id: -1, household: vars.household, parent: vars.parent ?? null, name: vars.name, category_type: vars.category_type, is_system: false, is_archived: false, sort_order: 999, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as Category,
              ],
            }
          : old
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["categories", { household: householdId, type, include_archived: showArchived }], ctx.prev);
      }
      setSubmitError(err.message || "Failed to create category");
    },
    onSuccess: (data) => {
      const qk = ["categories", { household: householdId, type, include_archived: showArchived }];
      queryClient.setQueryData(qk, (old: { results: Category[] } | undefined) =>
        old && !old.results.some((c) => c.id === data.id)
          ? { ...old, results: [...old.results, data].sort((a, b) => a.name.localeCompare(b.name)) }
          : old
      );
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setModalOpen(false);
      setForm({ name: "", parent: null, is_archived: false });
      setSubmitError(null);
    },
  });

  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Category> }) => updateCategory(id, data),
    onMutate: async ({ id, data }) => {
      const qk = ["categories", { household: householdId, type, include_archived: showArchived }];
      await queryClient.cancelQueries({ queryKey: ["categories"] });
      const prev = queryClient.getQueryData(qk);
      queryClient.setQueryData(qk, (old: { results: Category[] } | undefined) =>
        old
          ? {
              ...old,
              results: old.results.map((c) =>
                c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["categories", { household: householdId, type, include_archived: showArchived }], ctx.prev);
      }
      setSubmitError(err.message || "Failed to update category");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setModalOpen(false);
      setEditing(null);
      setSubmitError(null);
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteCategory,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  function openCreate() {
    setEditing(null);
    setForm({ name: "", parent: null, is_archived: false });
    setSubmitError(null);
    setModalOpen(true);
  }

  function openEdit(cat: Category) {
    setEditing(cat);
    setForm({ name: cat.name, parent: cat.parent, is_archived: cat.is_archived });
    setSubmitError(null);
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const trimmed = form.name.trim();
    if (trimmed.length < 2) {
      setSubmitError("Name must be at least 2 characters.");
      return;
    }
    if (editing) {
      updateMu.mutate({ id: editing.id, data: { name: trimmed, parent: form.parent, is_archived: form.is_archived } });
    } else if (householdId != null) {
      createMu.mutate({
        household: householdId,
        name: trimmed,
        category_type: type,
        parent: form.parent || undefined,
      });
    } else {
      setSubmitError("Select a household first.");
    }
  }

  function handleArchive(cat: Category) {
    updateMu.mutate({ id: cat.id, data: { is_archived: !cat.is_archived } });
  }

  function handleDelete(cat: Category) {
    if (confirm("Delete this category? If it has transactions or budgets, it will be archived instead.")) {
      deleteMu.mutate(cat.id);
    }
  }

  const parentsForType = categories.filter((c) => c.category_type === type && c.parent === null && !c.is_archived && c.id !== editing?.id);

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-4 min-w-0">
          <div className="flex rounded overflow-hidden border border-gray-300">
            <button
              type="button"
              onClick={() => setType("EXPENSE")}
              className={`px-4 py-2 text-sm font-medium ${type === "EXPENSE" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={() => setType("INCOME")}
              className={`px-4 py-2 text-sm font-medium ${type === "INCOME" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Income
            </button>
          </div>
          <input
            type="search"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm min-w-[200px]"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add category
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden max-h-[calc(100vh-16rem)] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-6 text-gray-500">No categories found.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {displayList.map((cat) => (
              <li key={cat.id} className="group flex items-center justify-between px-4 py-2 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${cat.is_archived ? "text-gray-400 line-through" : ""}`}>
                    {cat.name}
                  </span>
                  {cat.is_system && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Default</span>
                  )}
                  {cat.is_archived && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Archived</span>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(cat)} className="text-blue-600 text-sm py-1 px-2 hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => handleArchive(cat)}
                    className="text-sm py-1 px-2 hover:underline"
                  >
                    {cat.is_archived ? "Restore" : "Archive"}
                  </button>
                  <button onClick={() => handleDelete(cat)} className="text-red-600 text-sm py-1 px-2 hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold mb-4">
              {editing ? "Edit category" : "New category"}
            </h2>
            {submitError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                {submitError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                  placeholder="Category name"
                  required
                  minLength={2}
                />
              </div>
              {parentsForType.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Parent (optional)</label>
                  <select
                    value={form.parent ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, parent: e.target.value ? Number(e.target.value) : null }))
                    }
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                  >
                    <option value="">None</option>
                    {parentsForType.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editing && (
                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.is_archived}
                      onChange={(e) => setForm((f) => ({ ...f, is_archived: e.target.checked }))}
                    />
                    <span className="text-sm">Archived</span>
                  </label>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="py-2 px-4 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  disabled={createMu.isPending || updateMu.isPending}
                >
                  {createMu.isPending || updateMu.isPending ? "Saving…" : editing ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
