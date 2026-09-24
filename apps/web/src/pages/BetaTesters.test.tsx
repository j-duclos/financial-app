/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetaTesters from "./BetaTesters";

const staff = vi.hoisted(() => ({ isStaff: true }));
const api = vi.hoisted(() => ({
  listStaffBetaTesterInvitations: vi.fn(),
  createStaffBetaTesterInvitation: vi.fn(),
  resendStaffBetaTesterInvitation: vi.fn(),
  revokeStaffBetaTesterInvitation: vi.fn(),
  extendStaffComplimentaryPremium: vi.fn(),
}));

vi.mock("../lib/profileQuery", () => ({
  useProfileQuery: () => ({
    data: { is_staff: staff.isStaff, username: "admin" },
    isLoading: false,
  }),
}));

vi.mock("@budget-app/api-client", () => ({
  ApiError: class ApiError extends Error {
    status = 400;
  },
  listStaffBetaTesterInvitations: api.listStaffBetaTesterInvitations,
  createStaffBetaTesterInvitation: api.createStaffBetaTesterInvitation,
  resendStaffBetaTesterInvitation: api.resendStaffBetaTesterInvitation,
  revokeStaffBetaTesterInvitation: api.revokeStaffBetaTesterInvitation,
  extendStaffComplimentaryPremium: api.extendStaffComplimentaryPremium,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BetaTesters />
    </QueryClientProvider>
  );
}

describe("Beta Testers page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    staff.isStaff = true;
    api.listStaffBetaTesterInvitations.mockReset();
    api.createStaffBetaTesterInvitation.mockReset();
    api.listStaffBetaTesterInvitations.mockResolvedValue({ count: 0, results: [] });
  });

  it("forbids non-staff users", () => {
    staff.isStaff = false;
    renderPage();
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite beta tester" })).not.toBeInTheDocument();
  });

  it("shows empty state for staff", async () => {
    renderPage();
    expect(await screen.findByText("No beta testers yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite your first beta tester" })).toBeInTheDocument();
  });

  it("opens the invite modal", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Invite beta tester" }));
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("renders accepted and pending rows with the right actions", async () => {
    api.listStaffBetaTesterInvitations.mockResolvedValue({
      count: 2,
      results: [
        {
          id: 1,
          email: "pending@example.com",
          status: "pending",
          complimentary_premium_until: "2026-12-01T00:00:00Z",
          expires_at: "2026-10-01T00:00:00Z",
          created_at: "2026-09-24T00:00:00Z",
          accepted_at: null,
          accepted_user: null,
        },
        {
          id: 2,
          email: "accepted@example.com",
          status: "accepted",
          complimentary_premium_until: "2026-12-01T00:00:00Z",
          expires_at: "2026-10-01T00:00:00Z",
          created_at: "2026-09-20T00:00:00Z",
          accepted_at: "2026-09-21T00:00:00Z",
          accepted_user: { id: 9, username: "beta", email: "accepted@example.com" },
        },
      ],
    });
    renderPage();
    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("accepted@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View user" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extend Premium" })).toBeInTheDocument();
  });
});
