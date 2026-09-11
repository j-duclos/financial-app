import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REVIEW_PROMPT_COPY } from "./reviewPromptCopy";
import { FEEDBACK_CATEGORIES, REVIEW_PROMPT } from "./reviewPromptConfig";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(dir, rel), "utf8");
}

const host = read("ReviewPromptHost.tsx");
const enjoyment = read("EnjoymentPromptSheet.tsx");
const review = read("ReviewRequestSheet.tsx");
const feedback = read("FeedbackSheet.tsx");
const storeReview = read("storeReview.ts");
const layout = readFileSync(join(root, "app/(app)/_layout.tsx"), "utf8");
const profile = readFileSync(join(root, "features/profile/ProfileSettingsScreen.tsx"), "utf8");
const more = readFileSync(join(root, "features/more/MoreScreen.tsx"), "utf8");
const bottomSheet = readFileSync(join(root, "components/ui/BottomSheet.tsx"), "utf8");

describe("positive review flow", () => {
  it("opens the review-request modal after thumbs up", () => {
    expect(host).toMatch(/setStep\("review"\)/);
    expect(host).toMatch(/enjoyment_response: "positive"/);
    expect(review).toMatch(/REVIEW_PROMPT_COPY\.reviewTitle/);
    expect(review).toMatch(/REVIEW_PROMPT_COPY\.leaveReviewLabel/);
    expect(REVIEW_PROMPT_COPY.leaveReviewLabel).toBe("Leave a review");
    expect(REVIEW_PROMPT_COPY.reviewTitle).toBe("Would you leave FlowSight a review?");
    expect(`${enjoyment}${review}${host}`).not.toMatch(/5 stars/i);
    expect(`${enjoyment}${review}${host}`).not.toMatch(/five stars/i);
  });

  it("Leave a review calls the platform review API", () => {
    expect(host).toMatch(/requestStoreReview/);
    expect(host).toMatch(/review_flow_completed: true/);
    expect(storeReview).toMatch(/StoreReview\.isAvailableAsync/);
    expect(storeReview).toMatch(/StoreReview\.requestReview/);
    expect(storeReview).toMatch(/platform === "ios"/);
    expect(storeReview).toMatch(/platform === "android"/);
  });
});

describe("negative feedback flow", () => {
  it("opens the private feedback form and does not request a store review afterward", () => {
    expect(host).toMatch(/enjoyment_response: "negative"/);
    expect(host).toMatch(/setStep\("feedback"\)/);
    expect(feedback).toMatch(/REVIEW_PROMPT_COPY\.feedbackTitle/);
    expect(feedback).toMatch(/message\.trim\(\)/);
    expect(feedback).toMatch(/Please tell us what we can improve/);
    expect(FEEDBACK_CATEGORIES.map((c) => c.label)).toEqual(
      expect.arrayContaining([
        "Hard to use",
        "Missing feature",
        "Something is broken",
        "Performance",
        "Account / sync issue",
        "Other",
      ])
    );
    expect(host).toMatch(/submitFeedback/);
    expect(host).toMatch(/source: "mobile"/);
    expect(feedback).not.toMatch(/May we contact you/);
    expect(feedback).not.toMatch(/allowContact/);
    expect(feedback).not.toMatch(/accountEmail/);
    expect(host).not.toMatch(/allow_contact/);
    expect(feedback).toMatch(/REVIEW_PROMPT_COPY\.thanksTitle/);
    expect(REVIEW_PROMPT_COPY.thanksTitle).toBe("Thanks for the feedback.");
    const negativeHandler = host.slice(host.indexOf("const onNo"), host.indexOf("const onMaybeLater"));
    expect(negativeHandler).not.toMatch(/requestStoreReview/);
    expect(host).toMatch(/if \(step === "feedback"\)/);
  });
});

describe("review prompt host", () => {
  it("evaluates eligibility once from the authenticated app shell", () => {
    expect(layout).toMatch(/ReviewPromptHost/);
    expect(host).toMatch(/shouldShowEnjoymentPrompt/);
    expect(host).toMatch(/isBlockedReviewPromptPath/);
    expect(host).toMatch(/shouldShowOnboardingWelcome/);
    expect(host).toMatch(/evaluateDelayMs/);
    expect(REVIEW_PROMPT.snoozeDismissDays).toBe(30);
    expect(REVIEW_PROMPT.snoozeReviewDeclinedDays).toBe(90);
    expect(REVIEW_PROMPT.maxEnjoymentPromptsPerYear).toBe(2);
  });

  it("tracks existing sheets and confirm dialogs as blocking modals", () => {
    expect(bottomSheet).toMatch(/acquirePresentedModal/);
    expect(bottomSheet).toMatch(/useTrackPresentedModal\(visible, true\)/);
    expect(host).toMatch(/blockingModalOpen: openModals > 0/);
  });

  it("offers manual Send feedback without using the review timer", () => {
    expect(profile).toMatch(/title="Send feedback"/);
    expect(more).toMatch(/title="Send feedback"/);
    expect(host).toMatch(/manual-feedback/);
    expect(host).toMatch(/if \(step === "feedback"\)/);
    expect(host).toMatch(/feedback_submitted: true/);
    expect(enjoyment).toMatch(/REVIEW_PROMPT_COPY\.yesLabel/);
    expect(enjoyment).toMatch(/REVIEW_PROMPT_COPY\.noLabel/);
    expect(enjoyment).toMatch(/REVIEW_PROMPT_COPY\.notNowLabel/);
    expect(REVIEW_PROMPT_COPY.yesLabel).toBe("Yes, I’m enjoying FlowSight");
    expect(REVIEW_PROMPT_COPY.noLabel).toBe("No, I’m not enjoying FlowSight");
    expect(REVIEW_PROMPT_COPY.notNowLabel).toBe("Not now");
  });
});
