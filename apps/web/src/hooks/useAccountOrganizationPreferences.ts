import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ACCOUNT_ORG_PREFERENCES,
  loadAccountOrgPreferences,
  saveAccountOrgPreferences,
  type AccountGroupBy,
  type AccountLayoutMode,
  type AccountOrganizationFilters,
  type AccountOrganizationPreferences,
  type AccountSortBy,
} from "../lib/accountOrganization";

export function useAccountOrganizationPreferences() {
  const [prefs, setPrefs] = useState<AccountOrganizationPreferences>(() =>
    loadAccountOrgPreferences()
  );

  useEffect(() => {
    saveAccountOrgPreferences(prefs);
  }, [prefs]);

  const setGroupBy = useCallback((groupBy: AccountGroupBy) => {
    setPrefs((p) => ({ ...p, groupBy }));
  }, []);

  const setSortBy = useCallback((sortBy: AccountSortBy) => {
    setPrefs((p) => ({ ...p, sortBy }));
  }, []);

  const setLayoutMode = useCallback((layoutMode: AccountLayoutMode) => {
    setPrefs((p) => ({ ...p, layoutMode }));
  }, []);

  const setShowGroupSummaries = useCallback((showGroupSummaries: boolean) => {
    setPrefs((p) => ({ ...p, showGroupSummaries }));
  }, []);

  const setFilters = useCallback(
    (updater: (f: AccountOrganizationFilters) => AccountOrganizationFilters) => {
      setPrefs((p) => ({ ...p, filters: updater(p.filters) }));
    },
    []
  );

  const toggleGroupCollapsed = useCallback((groupKey: string) => {
    setPrefs((p) => {
      const collapsed = new Set(p.collapsedGroups);
      if (collapsed.has(groupKey)) collapsed.delete(groupKey);
      else collapsed.add(groupKey);
      return { ...p, collapsedGroups: [...collapsed] };
    });
  }, []);

  const isGroupCollapsed = useCallback(
    (groupKey: string) => prefs.collapsedGroups.includes(groupKey),
    [prefs.collapsedGroups]
  );

  const resetPreferences = useCallback(() => {
    setPrefs(DEFAULT_ACCOUNT_ORG_PREFERENCES);
  }, []);

  return {
    prefs,
    setGroupBy,
    setSortBy,
    setLayoutMode,
    setShowGroupSummaries,
    setFilters,
    toggleGroupCollapsed,
    isGroupCollapsed,
    resetPreferences,
  };
}
