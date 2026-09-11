import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  completionFromOnboardingStatus,
  homeEducationPriority,
  seedGettingStartedEducation,
  shouldShowCalendarIntro,
  shouldShowFirstAccountSuccess,
  shouldShowFirstTransactionForecast,
  shouldShowGettingStartedCard,
  shouldShowWelcomeOnce,
  type GettingStartedCompletion,
  type GettingStartedEducationFlags,
  type OnboardingStatus,
} from "@budget-app/shared";
import {
  educationFlagsEqual,
  getGettingStartedEducationCache,
  gettingStartedEducationStorageKey,
  mergeGettingStartedEducation,
  parseGettingStartedEducation,
  serializeGettingStartedEducation,
  setGettingStartedEducationCache,
  subscribeGettingStartedEducation,
} from "./gettingStartedStorage";

export function useGettingStartedEducation(opts: {
  userId: number | null | undefined;
  onboarding: OnboardingStatus | null | undefined;
}) {
  const { userId, onboarding } = opts;
  const [stored, setStored] = useState<GettingStartedEducationFlags | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (userId == null) {
      setStored(null);
      setHydrated(false);
      return;
    }
    const cached = getGettingStartedEducationCache(userId);
    if (cached) {
      setStored(cached);
      setHydrated(true);
    } else {
      setHydrated(false);
    }
    let cancelled = false;
    void AsyncStorage.getItem(gettingStartedEducationStorageKey(userId))
      .then((raw) => {
        if (cancelled) return;
        const cachedNow = getGettingStartedEducationCache(userId);
        if (cachedNow) {
          setStored(cachedNow);
          setHydrated(true);
          return;
        }
        const parsed = parseGettingStartedEducation(raw);
        if (parsed) {
          setGettingStartedEducationCache(userId, parsed);
          setStored(parsed);
        } else {
          setStored(null);
        }
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        const cachedNow = getGettingStartedEducationCache(userId);
        if (cachedNow) {
          setStored(cachedNow);
        } else {
          setStored(null);
        }
        setHydrated(true);
      });
    const unsubscribe = subscribeGettingStartedEducation(() => {
      if (cancelled) return;
      const next = getGettingStartedEducationCache(userId);
      if (!next) return;
      setStored((prev) => (prev != null && educationFlagsEqual(prev, next) ? prev : next));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  const dataCompletion: GettingStartedCompletion = useMemo(
    () => completionFromOnboardingStatus(onboarding, { calendarOpened: false }),
    [onboarding]
  );

  const flags: GettingStartedEducationFlags = useMemo(
    () =>
      seedGettingStartedEducation({
        stored,
        completion: {
          ...dataCompletion,
          calendar: stored?.calendar_intro_seen === true,
        },
        forecastReady: onboarding?.steps.forecast_ready === true || onboarding?.completed === true,
      }),
    [stored, dataCompletion, onboarding?.steps.forecast_ready, onboarding?.completed]
  );

  const completion: GettingStartedCompletion = useMemo(
    () => ({ ...dataCompletion, calendar: flags.calendar_intro_seen }),
    [dataCompletion, flags.calendar_intro_seen]
  );

  useEffect(() => {
    if (!hydrated || userId == null) return;
    const forecastReady =
      onboarding?.steps.forecast_ready === true || onboarding?.completed === true;
    const next =
      stored ??
      seedGettingStartedEducation({
        stored: null,
        completion: dataCompletion,
        forecastReady,
      });
    if (stored == null) {
      setStored(next);
    }
    const cached = getGettingStartedEducationCache(userId);
    if (cached && educationFlagsEqual(cached, next)) return;
    if (cached && stored != null && !educationFlagsEqual(cached, stored)) {
      // Cache was reset from outside this hook — do not clobber it with stale flags.
      return;
    }
    setGettingStartedEducationCache(userId, next);
    void AsyncStorage.setItem(
      gettingStartedEducationStorageKey(userId),
      serializeGettingStartedEducation(next)
    ).catch(() => undefined);
  }, [dataCompletion, hydrated, onboarding?.completed, onboarding?.steps.forecast_ready, stored, userId]);

  const persist = useCallback(
    (patch: Partial<GettingStartedEducationFlags>) => {
      setStored((prev) => {
        const base =
          prev ??
          seedGettingStartedEducation({
            stored: null,
            completion: dataCompletion,
            forecastReady:
              onboarding?.steps.forecast_ready === true || onboarding?.completed === true,
          });
        const next = mergeGettingStartedEducation(base, patch);
        if (prev != null && educationFlagsEqual(prev, next)) return prev;
        if (userId != null) {
          setGettingStartedEducationCache(userId, next);
          void AsyncStorage.setItem(
            gettingStartedEducationStorageKey(userId),
            serializeGettingStartedEducation(next)
          ).catch(() => undefined);
        }
        return next;
      });
    },
    [dataCompletion, onboarding?.completed, onboarding?.steps.forecast_ready, userId]
  );

  const showWelcome = shouldShowWelcomeOnce({
    showWelcome: onboarding?.show_welcome === true,
    homeForecastIntroSeen: flags.home_forecast_intro_seen,
  });
  const showFirstAccount = shouldShowFirstAccountSuccess({
    hasAccount: completion.account,
    firstAccountSuccessSeen: flags.first_account_success_seen,
  });
  const showFirstTransaction = shouldShowFirstTransactionForecast({
    hasUpcomingTransaction: completion.upcoming_transaction,
    firstTransactionForecastSeen: flags.first_transaction_forecast_seen,
  });
  const homePrompt = hydrated
    ? homeEducationPriority({
        showWelcome,
        showFirstAccount,
        showFirstTransaction,
      })
    : null;

  const showChecklist =
    hydrated &&
    shouldShowGettingStartedCard({
      completion,
      collapsed: flags.getting_started_collapsed,
      educationFlags: flags,
    });

  return {
    ready: hydrated,
    flags,
    completion,
    showChecklist,
    homePrompt,
    showCalendarIntro: hydrated && shouldShowCalendarIntro({ calendarIntroSeen: flags.calendar_intro_seen }),
    markWelcomeSeen: () => persist({ home_forecast_intro_seen: true }),
    markFirstAccountSeen: () => persist({ first_account_success_seen: true }),
    markFirstTransactionSeen: () => persist({ first_transaction_forecast_seen: true }),
    markCalendarOpened: () => persist({ calendar_intro_seen: true }),
    markCalendarOnboardingHandoffSeen: () => persist({ calendar_onboarding_handoff_seen: true }),
    collapseChecklist: () => persist({ getting_started_collapsed: true }),
  };
}
