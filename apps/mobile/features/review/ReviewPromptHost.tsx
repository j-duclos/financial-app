import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { usePathname } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getReviewPromptState,
  patchReviewPromptState,
  submitFeedback,
  type FeedbackPayload,
} from "@budget-app/api-client";
import { isMissingAccounts, shouldShowOnboardingWelcome } from "@budget-app/shared";
import { useAuth } from "@/features/auth";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { EnjoymentPromptSheet } from "./EnjoymentPromptSheet";
import { FeedbackSheet } from "./FeedbackSheet";
import { ReviewRequestSheet } from "./ReviewRequestSheet";
import { getOpenModalCount, subscribeOpenModalCount } from "@/lib/modalPresentation";
import { REVIEW_PROMPT } from "./reviewPromptConfig";
import {
  dismissedUntilAfterNegative,
  dismissedUntilAfterNotNow,
  dismissedUntilAfterReviewDeclined,
  isBlockedReviewPromptPath,
  shouldShowEnjoymentPrompt,
} from "./reviewPromptEligibility";
import { REVIEW_PROMPT_QUERY_KEY, snapshotFromApi } from "./reviewPromptState";
import { requestStoreReview } from "./storeReview";

type Step = "idle" | "enjoyment" | "review" | "feedback" | "manual-feedback";

type ReviewFeedbackContextValue = {
  openFeedback: () => void;
};

const ReviewFeedbackContext = createContext<ReviewFeedbackContextValue>({
  openFeedback: () => {},
});

export function useReviewFeedback(): ReviewFeedbackContextValue {
  return useContext(ReviewFeedbackContext);
}

function appVersionMeta(): Pick<FeedbackPayload, "app_version" | "build_number" | "device_os_version"> {
  return {
    app_version: Constants.expoConfig?.version ?? "",
    build_number: String(
      Constants.nativeBuildVersion ??
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.expoConfig?.android?.versionCode ??
        ""
    ),
    device_os_version: Device.osVersion ?? "",
  };
}

export function ReviewPromptHost({ children }: { children?: React.ReactNode }) {
  const { auth } = useAuth();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { status: onboarding, isLoading: onboardingLoading } = useOnboardingStatus();
  const [step, setStep] = useState<Step>("idle");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [openModals, setOpenModals] = useState(getOpenModalCount);
  const [readyToEvaluate, setReadyToEvaluate] = useState(false);
  const presentingRef = useRef(false);

  const stateQuery = useQuery({
    queryKey: REVIEW_PROMPT_QUERY_KEY,
    queryFn: getReviewPromptState,
    enabled: auth.isAuthenticated,
    staleTime: 60_000,
  });

  const patchState = useMutation({
    mutationFn: patchReviewPromptState,
    onSuccess: (data) => {
      queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, data);
    },
  });

  const sendFeedback = useMutation({
    mutationFn: submitFeedback,
  });

  useEffect(() => {
    return subscribeOpenModalCount(setOpenModals);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setForeground(next === "active");
      if (next === "active" && auth.isAuthenticated) {
        void patchReviewPromptState({ record_session: true })
          .then((data) => queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, data))
          .catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [auth.isAuthenticated, queryClient]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    void patchReviewPromptState({ record_session: true })
      .then((data) => queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, data))
      .catch(() => undefined);
  }, [auth.isAuthenticated, queryClient]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setReadyToEvaluate(false);
      return;
    }
    const timer = setTimeout(() => setReadyToEvaluate(true), REVIEW_PROMPT.evaluateDelayMs);
    return () => clearTimeout(timer);
  }, [auth.isAuthenticated]);

  const snapshot = snapshotFromApi(stateQuery.data);
  const onboardingActive =
    onboardingLoading || shouldShowOnboardingWelcome(onboarding) || isMissingAccounts(onboarding);
  const eligible =
    step === "idle" &&
    shouldShowEnjoymentPrompt(snapshot, {
      now: new Date(),
      authenticated: auth.isAuthenticated,
      bootstrapComplete: readyToEvaluate && !auth.initializing && stateQuery.isFetched,
      appInForeground: foreground,
      onboardingActive,
      blockingModalOpen: openModals > 0,
      criticalError: false,
      criticalFundsModalOpen: false,
      blockedRoute: isBlockedReviewPromptPath(pathname),
    });

  useEffect(() => {
    if (!eligible || presentingRef.current) return;
    presentingRef.current = true;
    setStep("enjoyment");
    void patchReviewPromptState({ mark_prompt_shown: true })
      .then((data) => queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, data))
      .catch(() => undefined);
  }, [eligible, queryClient]);

  const closeFlow = useCallback(() => {
    presentingRef.current = false;
    setStep("idle");
  }, []);

  const openFeedback = useCallback(() => {
    setStep("manual-feedback");
  }, []);

  const onNotNow = useCallback(() => {
    const dismissed_until = dismissedUntilAfterNotNow(new Date());
    queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, (old: typeof stateQuery.data) =>
      old ? { ...old, dismissed_until } : old
    );
    void patchState.mutateAsync({ dismissed_until });
    closeFlow();
  }, [closeFlow, patchState, queryClient, stateQuery.data]);

  const onYes = useCallback(() => {
    queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, (old: typeof stateQuery.data) =>
      old ? { ...old, enjoyment_response: "positive" } : old
    );
    void patchState.mutateAsync({ enjoyment_response: "positive" });
    setStep("review");
  }, [patchState, queryClient, stateQuery.data]);

  const onNo = useCallback(() => {
    const dismissed_until = dismissedUntilAfterNegative(new Date());
    queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, (old: typeof stateQuery.data) =>
      old ? { ...old, enjoyment_response: "negative", dismissed_until } : old
    );
    void patchState.mutateAsync({
      enjoyment_response: "negative",
      dismissed_until,
    });
    setStep("feedback");
  }, [patchState, queryClient, stateQuery.data]);

  const onMaybeLater = useCallback(() => {
    const dismissed_until = dismissedUntilAfterReviewDeclined(new Date());
    queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, (old: typeof stateQuery.data) =>
      old ? { ...old, dismissed_until, review_asked_at: new Date().toISOString() } : old
    );
    void patchState.mutateAsync({
      review_asked_at: true,
      dismissed_until,
    });
    closeFlow();
  }, [closeFlow, patchState, queryClient, stateQuery.data]);

  const onLeaveReview = useCallback(async () => {
    queryClient.setQueryData(REVIEW_PROMPT_QUERY_KEY, (old: typeof stateQuery.data) =>
      old
        ? {
            ...old,
            review_flow_completed: true,
            review_asked_at: new Date().toISOString(),
          }
        : old
    );
    await patchState.mutateAsync({
      review_asked_at: true,
      review_flow_completed: true,
    });
    await requestStoreReview();
    closeFlow();
  }, [closeFlow, patchState, queryClient, stateQuery.data]);

  const onSubmitFeedback = useCallback(
    async (payload: { message: string; category: string }) => {
      const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown";
      await sendFeedback.mutateAsync({
        source: "mobile",
        platform,
        category: (payload.category || "") as FeedbackPayload["category"],
        message: payload.message,
        ...appVersionMeta(),
      });
      if (step === "feedback") {
        await patchState.mutateAsync({ feedback_submitted: true });
      }
    },
    [patchState, sendFeedback, step]
  );

  const contextValue = useMemo(() => ({ openFeedback }), [openFeedback]);

  return (
    <ReviewFeedbackContext.Provider value={contextValue}>
      {children}
      <EnjoymentPromptSheet
        visible={step === "enjoyment"}
        onYes={onYes}
        onNo={onNo}
        onNotNow={onNotNow}
      />
      <ReviewRequestSheet
        visible={step === "review"}
        onLeaveReview={() => void onLeaveReview()}
        onMaybeLater={onMaybeLater}
      />
      <FeedbackSheet
        visible={step === "feedback" || step === "manual-feedback"}
        submitting={sendFeedback.isPending}
        onClose={closeFlow}
        onSubmit={onSubmitFeedback}
      />
    </ReviewFeedbackContext.Provider>
  );
}
