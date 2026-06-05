import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import type { Account } from "@budget-app/shared";
import {
  PASSIVE_FORECAST_DAY_OPTIONS,
  type PassiveForecastDays,
} from "../../lib/safeToSpendLabels";
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
  type ForecastInclusionFilter,
  type PlaidSourceFilter,
} from "../../lib/accountOrganization";

type Props = {
  forecastDays: PassiveForecastDays;
  onForecastDaysChange: (days: PassiveForecastDays) => void;
  groupBy: AccountGroupBy;
  sortBy: AccountSortBy;
  layoutMode: AccountLayoutMode;
  showGroupSummaries: boolean;
  filters: AccountOrganizationFilters;
  accounts: Account[];
  summaryLine: string;
  onGroupByChange: (v: AccountGroupBy) => void;
  onSortByChange: (v: AccountSortBy) => void;
  onLayoutModeChange: (v: AccountLayoutMode) => void;
  onShowGroupSummariesChange: (v: boolean) => void;
  onFiltersChange: (updater: (f: AccountOrganizationFilters) => AccountOrganizationFilters) => void;
  onReset: () => void;
};

export default function AccountOrganizationToolbar({
  forecastDays,
  onForecastDaysChange,
  groupBy,
  sortBy,
  layoutMode,
  showGroupSummaries,
  filters,
  accounts,
  summaryLine,
  onGroupByChange,
  onSortByChange,
  onLayoutModeChange,
  onShowGroupSummariesChange,
  onFiltersChange,
  onReset,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const institutions = uniqueInstitutions(accounts);
  const forecastInclusion =
    filters.forecastInclusion ?? (filters.forecastOnly ? "included" : "all");
  const activeFilterCount =
    (filters.riskOnly ? 1 : 0) +
    (filters.showArchived ? 1 : 0) +
    (filters.showClosed ? 1 : 0) +
    (filters.showDeleted ? 1 : 0) +
    (filters.spendingOnly ? 1 : 0) +
    (filters.debtOnly ? 1 : 0) +
    (forecastInclusion !== "all" ? 1 : 0) +
    (filters.plaidSource !== "all" ? 1 : 0) +
    filters.institutions.length +
    filters.roles.length +
    filters.healthStatuses.length;

  return (
    <div className="mb-4 space-y-3" data-testid="accounts-controls-row">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-600 flex flex-col gap-1 min-w-[7rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Forecast window</span>
          <select
            value={forecastDays}
            onChange={(e) => onForecastDaysChange(Number(e.target.value) as ForecastDays)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
            data-testid="forecast-window-select"
          >
            {PASSIVE_FORECAST_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1 min-w-[8rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Group by</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value as AccountGroupBy)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
            data-testid="group-by-select"
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
            data-testid="sort-by-select"
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
            data-testid="layout-select"
          >
            {LAYOUT_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex items-center gap-2 pb-1.5 hidden sm:flex">
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
          data-testid="filters-toggle"
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
          data-testid="reset-view-button"
        >
          Reset view
        </button>
        <span
          className="text-sm text-gray-500 pb-1.5 ml-auto"
          data-testid="accounts-summary-line"
        >
          {summaryLine}
        </span>
      </div>

      {filtersOpen ? (
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
          data-testid="accounts-filters-panel"
        >
          <fieldset>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Status
            </legend>
            <div className="flex flex-wrap gap-4">
              <FilterToggle
                label="Active only"
                checked={
                  !filters.showArchived &&
                  !filters.showClosed &&
                  !filters.showDeleted
                }
                onChange={(v) => {
                  if (v) {
                    onFiltersChange((f) => ({
                      ...f,
                      showArchived: false,
                      showClosed: false,
                      showDeleted: false,
                    }));
                  }
                }}
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
                label="At-risk only"
                checked={filters.riskOnly}
                onChange={(v) => onFiltersChange((f) => ({ ...f, riskOnly: v }))}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Forecast inclusion
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "all", label: "All" },
                  { value: "included", label: "In forecast" },
                  { value: "excluded", label: "Excluded" },
                ] as { value: ForecastInclusionFilter; label: string }[]
              ).map(({ value, label }) => (
                <FilterChip
                  key={value}
                  label={label}
                  checked={forecastInclusion === value}
                  onChange={() =>
                    onFiltersChange((f) => ({
                      ...f,
                      forecastInclusion: value,
                      forecastOnly: value === "included",
                    }))
                  }
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Bank link
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "all", label: "All" },
                  { value: "plaid", label: "Plaid-linked" },
                  { value: "manual", label: "Manual" },
                ] as { value: PlaidSourceFilter; label: string }[]
              ).map(({ value, label }) => (
                <FilterChip
                  key={value}
                  label={label}
                  checked={(filters.plaidSource ?? "all") === value}
                  onChange={() => onFiltersChange((f) => ({ ...f, plaidSource: value }))}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-4 sm:hidden">
            <FilterToggle
              label="Group totals"
              checked={showGroupSummaries}
              onChange={onShowGroupSummariesChange}
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
