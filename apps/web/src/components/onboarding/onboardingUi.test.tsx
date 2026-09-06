/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStatus } from "@budget-app/shared";
import EmptyState from "./EmptyState";
import OnboardingChecklist from "./OnboardingChecklist";
import OnboardingWelcomeModal from "./OnboardingWelcomeModal";

afterEach(() => {
  cleanup();
});

const newUserStatus: OnboardingStatus = {
  completed: false,
  dismissed: false,
  show_welcome: true,
  steps: {
    account: false,
    transaction: false,
    recurring: false,
    forecast_ready: false,
  },
  progress: { completed_steps: 0, total_steps: 4 },
};

const accountOnlyStatus: OnboardingStatus = {
  ...newUserStatus,
  steps: {
    account: true,
    transaction: false,
    recurring: false,
    forecast_ready: false,
  },
  progress: { completed_steps: 1, total_steps: 4 },
};

describe("OnboardingWelcomeModal", () => {
  it("shows the welcome copy and Get started for a new user", () => {
    render(
      <OnboardingWelcomeModal open onGetStarted={() => undefined} onSkip={() => undefined} />
    );
    expect(screen.getByTestId("onboarding-welcome")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "See your money before it happens." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get started" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip onboarding for now" })).toBeInTheDocument();
  });

  it("does not render when closed (completed users)", () => {
    render(
      <OnboardingWelcomeModal
        open={false}
        onGetStarted={() => undefined}
        onSkip={() => undefined}
      />
    );
    expect(screen.queryByTestId("onboarding-welcome")).not.toBeInTheDocument();
  });

  it("calls skip when Skip for now is pressed", async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(
      <OnboardingWelcomeModal open onGetStarted={() => undefined} onSkip={onSkip} />
    );
    await user.click(screen.getByRole("button", { name: "Skip onboarding for now" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingChecklist", () => {
  it("updates complete/incomplete from status data", () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist status={accountOnlyStatus} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("onboarding-checklist")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 complete")).toBeInTheDocument();
    expect(screen.getByText("Add an account").closest("a")).toHaveAttribute("href", "/accounts?new=1");
    expect(screen.getAllByText("Complete")).toHaveLength(1);
    expect(screen.getAllByText("Incomplete")).toHaveLength(3);
  });

  it("points Premium users at Accounts instead of forcing the create modal", () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist status={newUserStatus} isPremium />
      </MemoryRouter>
    );
    expect(screen.getByText("Add an account").closest("a")).toHaveAttribute("href", "/accounts");
  });
});

describe("EmptyState", () => {
  it("renders Free manual account CTAs without a Plaid primary action", () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="No accounts yet"
          description="Add the checking, savings, or credit card accounts you want to track."
          primaryAction={{ label: "Add account manually", to: "/accounts?new=1" }}
          secondaryAction={{ label: "Upgrade for automatic bank syncing", to: "/profile" }}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Add account manually" })).toHaveAttribute(
      "href",
      "/accounts?new=1"
    );
    expect(screen.getByRole("link", { name: "Upgrade for automatic bank syncing" })).toHaveAttribute(
      "href",
      "/profile"
    );
    expect(screen.queryByRole("link", { name: "Connect bank" })).not.toBeInTheDocument();
  });

  it("can show Connect bank for Premium users", () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="No accounts yet"
          description="Add the checking, savings, or credit card accounts you want to track."
          primaryAction={{ label: "Add account manually", to: "/accounts?new=1" }}
          secondaryAction={{ label: "Connect bank", to: "/accounts" }}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Connect bank" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add account manually" })).toBeInTheDocument();
  });
});
