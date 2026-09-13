import { useEffect, useRef } from "react";
import { useProfile } from "@/lib/profileQuery";
import { singleHouseholdIdIfUnambiguous } from "@/lib/householdContext";
import { markStartupQueryFinished, markStartupQueryStarted } from "@/lib/startupTrace";
import { useHouseholds } from "./useHouseholds";

/**
 * Profile default household, with a safe single-household repair.
 * Does not pick among multiple households.
 */
export function useDefaultHouseholdId(): {
  householdId: number | null;
  isLoading: boolean;
  isReady: boolean;
} {
  const { data: profile, isLoading, isFetched, isError } = useProfile();
  const needsList = profile != null && profile.default_household == null;
  const householdsQuery = useHouseholds({ enabled: needsList });

  const fromList = singleHouseholdIdIfUnambiguous(householdsQuery.data);
  const householdId = profile?.default_household ?? fromList ?? null;
  const waitingForList = needsList && householdsQuery.isLoading;
  const isReady = (isFetched || isError || profile != null) && !waitingForList;
  const markedReady = useRef(false);

  useEffect(() => {
    if (!isReady || needsList || markedReady.current) return;
    markedReady.current = true;
    markStartupQueryStarted("household", "cache_hit");
    markStartupQueryFinished("household", { cache: "cache_hit", durationMs: 0, status: "ok" });
  }, [isReady, needsList]);

  return {
    householdId,
    isLoading: (isLoading && !isReady) || waitingForList,
    isReady,
  };
}
