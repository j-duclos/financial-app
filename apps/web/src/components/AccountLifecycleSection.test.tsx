/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountLifecycleSection from "./AccountLifecycleSection";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  navigate: vi.fn(),
  getDeleteAccountPreflight: vi.fn(),
  downloadProfileExport: vi.fn(),
  downloadTransactionsCsv: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

vi.mock("@budget-app/api-client", () => ({
  getDeleteAccountPreflight: mocks.getDeleteAccountPreflight,
  downloadProfileExport: mocks.downloadProfileExport,
  downloadTransactionsCsv: mocks.downloadTransactionsCsv,
  deleteUserAccount: mocks.deleteUserAccount,
  resendVerification: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ logout: mocks.logout }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

const allowedPreflight = {
  can_delete: true,
  blocking_reasons: [],
  active_subscription: false,
  has_email: true,
  email_verified: true,
  households: [
    {
      household_id: 1,
      household_name: "Mine",
      user_role: "OWNER",
      member_count: 1,
      owner_count: 1,
      exclusive: true,
    },
  ],
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<AccountLifecycleSection />, { wrapper });
}

describe("AccountLifecycleSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.logout.mockReset();
    mocks.navigate.mockReset();
    mocks.getDeleteAccountPreflight.mockReset();
    mocks.downloadProfileExport.mockReset();
    mocks.downloadTransactionsCsv.mockReset();
    mocks.deleteUserAccount.mockReset();
    mocks.getDeleteAccountPreflight.mockResolvedValue(allowedPreflight);
    mocks.downloadProfileExport.mockResolvedValue(undefined);
    mocks.downloadTransactionsCsv.mockResolvedValue(undefined);
    mocks.deleteUserAccount.mockResolvedValue({ detail: "Your account has been deleted." });
  });

  it("downloads JSON and CSV from the backend", async () => {
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByText("Download a copy of the financial data available to your account.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(mocks.downloadProfileExport).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Download transactions CSV" }));
    await waitFor(() => expect(mocks.downloadTransactionsCsv).toHaveBeenCalledTimes(1));
    expect(mocks.downloadProfileExport).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion when the user is the only household owner", async () => {
    mocks.getDeleteAccountPreflight.mockResolvedValue({
      ...allowedPreflight,
      can_delete: false,
      blocking_reasons: [
        {
          code: "household_owner_transfer_required",
          household_id: 4,
          household_name: "Household X",
        },
      ],
    });
    const user = userEvent.setup();
    renderSection();
    expect(
      await screen.findByText(
        "You are the only owner of Household X. Transfer ownership before deleting your account."
      )
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Current password"), "testpass123");
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
  });

  it("requires password and DELETE, then logs out after success", async () => {
    const user = userEvent.setup();
    renderSection();
    const submit = await screen.findByRole("button", { name: "Delete account" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(await screen.findByText("Type DELETE to confirm account deletion.")).toBeInTheDocument();
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(submit);
    expect(await screen.findByText("Enter your current password.")).toBeInTheDocument();
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Current password"), "testpass123");
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.deleteUserAccount).toHaveBeenCalledWith({
        current_password: "testpass123",
        confirmation: "DELETE",
      })
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/login", {
      replace: true,
      state: { message: "Your account has been deleted." },
    });
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
