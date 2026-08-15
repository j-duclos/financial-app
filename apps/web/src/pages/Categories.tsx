import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryType } from "@budget-app/shared";
import {
  listHouseholds,
  createCategory,
  updateCategory,
  deleteCategory,
  getProfile,
} from "@budget-app/api-client";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";
import { useCategories } from "../hooks/useCategories";
import CategoryActionsMenu from "../components/categories/CategoryActionsMenu";
import {
  categoryRowActions,
  filterManagedCategories,
  groupManagedCategories,
  type CategorySourceFilter,
} from "../lib/categoryList";

const SOURCE_FILTERS: { value: CategorySourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
  { value: "default", label: "Default" },
];

function CategorySection({
  title,
  categories,
  showHeading,
  onEdit,
  onArchive,
  onDelete,
}: {
  title: string;
  categories: Category[];
  showHeading: boolean;
  onEdit: (cat: Category) => void;
  onArchive: (cat: Category) => void;
  onDelete: (cat: Category) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <>
      {showHeading && (
        <tr className="bg-gray-50">
          <th
            colSpan={4}
            className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            {title}
          </th>
        </tr>
      )}
      {categories.map((cat) => {
        const actions = categoryRowActions(cat);
        return (
          <tr
            key={cat.id}
            className={`border-t border-gray-100 ${
              cat.is_archived ? "bg-gray-50 text-gray-400" : "hover:bg-gray-50"
            }`}
          >
            <td className="px-4 py-2 text-sm min-w-0">
              <span className={`font-medium ${cat.is_archived ? "line-through" : "text-gray-900"}`}>
                {cat.name}
              </span>
              <span className="sm:hidden ml-2 inline-flex flex-wrap gap-1 align-middle">
                {cat.is_system && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Default</span>
                )}
                {cat.is_archived && (
                  <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Archived</span>
                )}
              </span>
            </td>
            <td className="hidden sm:table-cell px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
              {cat.is_system ? "Default" : "Custom"}
            </td>
            <td className="hidden sm:table-cell px-4 py-2 text-sm whitespace-nowrap">
              {cat.is_archived ? (
                <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Archived</span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
            <td className="px-4 py-2 text-right">
              <div className="inline-flex justify-end">
                <CategoryActionsMenu
                  onEdit={() => onEdit(cat)}
                  onArchive={actions.archive ? () => onArchive(cat) : undefined}
                  onRestore={actions.restore ? () => onArchive(cat) : undefined}
                  onDelete={() => onDelete(cat)}
                />
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export default function Categories() {
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [source, setSource] = useState<CategorySourceFilter>("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; parent: number | null; is_archived: boolean }>({
    name: "",
    parent: null,
    is_archived: false,
  });
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const householdId = profile?.default_household ?? households?.[0]?.id;

  const { data: categoriesData } = useCategories({
    householdId,
    includeArchived: true,
    enabled: !!householdId,
  });

  const categories = categoriesData?.results ?? [];
  const filtered = useMemo(
    () =>
      filterManagedCategories(categories, {
        type,
        source,
        search,
        showArchived,
      }),
    [categories, type, source, search, showArchived]
  );
  const grouped = useMemo(() => groupManagedCategories(filtered), [filtered]);
  const showSectionHeadings = source === "all";

  const createMu = useMutation({
    mutationFn: (body: { household: number; name: string; category_type: string; parent?: number | null }) =>
      createCategory(body),
    onError: (err) => {
      setSubmitError(err.message || "Failed to create category");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setModalOpen(false);
      setForm({ name: "", parent: null, is_archived: false });
      setSubmitError(null);
    },
  });

  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Category> }) => updateCategory(id, data),
    onError: (err) => {
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
    onSuccess: () => {
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
      updateMu.mutate({
        id: editing.id,
        data: { name: trimmed, parent: form.parent, is_archived: form.is_archived },
      });
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

  const parentsForType = categories.filter(
    (c) => c.category_type === type && c.parent === null && !c.is_archived && c.id !== editing?.id
  );

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">Categories</h1>
        <p className="text-sm text-gray-600 mt-1">
          Configuration for income and expense categories used across Budget, Transactions, and Reports.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex rounded overflow-hidden border border-gray-300" role="tablist" aria-label="Category type">
            <button
              type="button"
              role="tab"
              aria-selected={type === "EXPENSE"}
              onClick={() => setType("EXPENSE")}
              className={`px-4 py-2 text-sm font-medium ${type === "EXPENSE" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Expense
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={type === "INCOME"}
              onClick={() => setType("INCOME")}
              className={`px-4 py-2 text-sm font-medium ${type === "INCOME" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Income
            </button>
          </div>
          <div className="flex rounded overflow-hidden border border-gray-300" role="group" aria-label="Category source">
            {SOURCE_FILTERS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={source === opt.value}
                onClick={() => setSource(opt.value)}
                className={`px-3 py-2 text-sm font-medium ${
                  source === opt.value ? "bg-gray-800 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search categories"
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

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-[calc(100vh-16rem)] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-6 text-gray-500">No categories found.</p>
        ) : (
          <table className="min-w-full table-fixed divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Category
                </th>
                <th className="hidden sm:table-cell px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-28">
                  Source
                </th>
                <th className="hidden sm:table-cell px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-28">
                  Status
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide w-16">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <CategorySection
                title="Custom"
                categories={grouped.custom}
                showHeading={showSectionHeadings}
                onEdit={openEdit}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
              <CategorySection
                title="Default"
                categories={grouped.system}
                showHeading={showSectionHeadings}
                onEdit={openEdit}
                onArchive={handleArchive}
                onDelete={handleDelete}
              />
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit category" : "New category"}</h2>
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
