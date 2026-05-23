import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { Account } from "@budget-app/shared";
import {
  GROUP_BY_OPTIONS,
  HEALTH_FILTER_OPTIONS,
  LAYOUT_MODE_OPTIONS,
  ROLE_FILTER_OPTIONS,
  SORT_BY_OPTIONS,
  uniqueInstitutions,
  type AccountGroupBy,
  type AccountLayoutMode,
  type AccountOrganizationFilters,
  type AccountSortBy,
} from "../../lib/accountOrganization";

type Props = {
  groupBy: AccountGroupBy;
  sortBy: AccountSortBy;
  layoutMode: AccountLayoutMode;
  showGroupSummaries: boolean;
  filters: AccountOrganizationFilters;
  accounts: Account[];
  filteredCount: number;
  onGroupByChange: (v: AccountGroupBy) => void;
  onSortByChange: (v: AccountSortBy) => void;
  onLayoutModeChange: (v: AccountLayoutMode) => void;
  onShowGroupSummariesChange: (v: boolean) => void;
  onFiltersChange: (updater: (f: AccountOrganizationFilters) => AccountOrganizationFilters) => void;
  onReset: () => void;
};

export default function AccountOrganizationToolbar({
  groupBy,
  sortBy,
  layoutMode,
  showGroupSummaries,
  filters,
  accounts,
  filteredCount,
  onGroupByChange,
  onSortByChange,
  onLayoutModeChange,
  onShowGroupSummariesChange,
  onFiltersChange,
  onReset,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const institutions = uniqueInstitutions(accounts);
  const activeFilterCount =
    (filters.riskOnly ? 1 : 0) +
    (filters.showArchived ? 1 : 0) +
    (filters.showClosed ? 1 : 0) +
    (filters.showDeleted ? 1 : 0) +
    (filters.spendingOnly ? 1 : 0) +
    (filters.debtOnly ? 1 : 0) +
    (filters.forecastOnly ? 1 : 0) +
    filters.institutions.length +
    filters.roles.length +
    filters.healthStatuses.length;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-600 flex flex-col gap-1 min-w-[8rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Group by</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as AccountGroupBy)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1 min-w-[10rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sort by</span>
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as AccountSortBy)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            {SORT_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1 min-w-[8rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Layout</span>
          <select
            value={layoutMode}
            onChange={(e) => onLayoutModeChange(e.target.value as AccountLayoutMode)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            {LAYOUT_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={showGroupSummaries}
            onChange={(e) => onShowGroupSummariesChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Group totals
        </label>
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-blue-100 text-blue-800 px-1.5 text-xs font-medium">
              {activeFilterCount}
            </span>
          ) : null}
          {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="text-sm text-gray-500 hover:text-gray-800 pb-1.5"
        >
          Reset view
        </button>
        <span className="text-sm text-gray-500 pb-1.5 ml-auto">
          {filteredCount} account{filteredCount === 1 ? "" : "s"}
        </span>
      </div>

      {filtersOpen ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex flex-wrap gap-4">
            <FilterToggle
              label="At-risk only"
              checked={filters.riskOnly}
              onChange={(v) => onFiltersChange((f) => ({ ...f, riskOnly: v }))}
            />
            <FilterToggle
              label="Show archived"
              checked={filters.showArchived}
              onChange={(v) => onFiltersChange((f) => ({ ...f, showArchived: v }))}
            />
            <FilterToggle
              label="Show closed"
              checked={filters.showClosed}
              onChange={(v) => onFiltersChange((f) => ({ ...f, showClosed: v }))}
            />
            <FilterToggle
              label="Show deleted"
              checked={filters.showDeleted}
              onChange={(v) => onFiltersChange((f) => ({ ...f, showDeleted: v }))}
            />
            <FilterToggle
              label="Spending accounts"
              checked={filters.spendingOnly}
              onChange={(v) => onFiltersChange((f) => ({ ...f, spendingOnly: v }))}
            />
            <FilterToggle
              label="Debt accounts"
              checked={filters.debtOnly}
              onChange={(v) => onFiltersChange((f) => ({ ...f, debtOnly: v }))}
            />
            <FilterToggle
              label="In forecast only"
              checked={filters.forecastOnly}
              onChange={(v) => onFiltersChange((f) => ({ ...f, forecastOnly: v }))}
            />
          </div>
          {institutions.length > 1 ? (
            <fieldset>
              <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Institution
              </legend>
              <div className="flex flex-wrap gap-2">
                {institutions.map((inst) => {
                  const checked = filters.institutions.includes(inst);
                  return (
                    <FilterChip
                      key={inst}
                      label={inst}
                      checked={checked}
                      onChange={() =>
                        onFiltersChange((f) => ({
                          ...f,
                          institutions: checked
                            ? f.institutions.filter((i) => i !== inst)
                            : [...f.institutions, inst],
                        }))
                      }
                    />
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <fieldset>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Role</legend>
            <div className="flex flex-wrap gap-2">
              {ROLE_FILTER_OPTIONS.map(({ value, label }) => {
                const checked = filters.roles.includes(value);
                return (
                  <FilterChip
                    key={value}
                    label={label}
                    checked={checked}
                    onChange={() =>
                      onFiltersChange((f) => ({
                        ...f,
                        roles: checked ? f.roles.filter((r) => r !== value) : [...f.roles, value],
                      }))
                    }
                  />
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Health</legend>
            <div className="flex flex-wrap gap-2">
              {HEALTH_FILTER_OPTIONS.map(({ value, label }) => {
                const checked = filters.healthStatuses.includes(value);
                return (
                  <FilterChip
                    key={value}
                    label={label}
                    checked={checked}
                    onChange={() =>
                      onFiltersChange((f) => ({
                        ...f,
                        healthStatuses: checked
                          ? f.healthStatuses.filter((h) => h !== value)
                          : [...f.healthStatuses, value],
                      }))
                    }
                  />
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="text-sm text-gray-700 flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
      />
      {label}
    </label>
  );
}

function FilterChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
        checked
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
      }`}
    >
      {label}
    </button>
  );
}
