/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Invite from "./Invite";

const api = vi.hoisted(() => ({
  previewComplimentaryInvitation: vi.fn(),
  acceptComplimentaryInvitation: vi.fn(),
}));

vi.mock("@budget-app/api-client", () => ({
  previewComplimentaryInvitation: api.previewComplimentaryInvitation,
  acceptComplimentaryInvitation: api.acceptComplimentaryInvitation,
  resendVerification: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ auth: { access: null, loading: false } }),
}));

function renderInvite(token = "tok") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/invite?token=${token}`]}>
        <Routes>
          <Route path="/invite" element={<Invite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Invite page", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  beforeEach(() => {
    api.previewComplimentaryInvitation.mockReset();
    api.acceptComplimentaryInvitation.mockReset();
  });

  it("shows the invited email and both create/sign-in actions without revealing account existence", async () => {
    api.previewComplimentaryInvitation.mockResolvedValue({
      status: "pending",
      email: "beta@example.com",
      complimentary_premium_until: "2026-12-01T00:00:00Z",
    });
    renderInvite();
    expect(await screen.findByText(/invited to FlowSight Premium/i)).toBeInTheDocument();
    expect(screen.getByText("beta@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/register?invite=tok&email=beta%40example.com"
    );
    expect(screen.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute(
      "href",
      "/login?invite=tok"
    );
    expect(screen.queryByText(/already have an account/i)).not.toBeInTheDocument();
  });

  it("shows success copy after a valid invitation is already accepted", async () => {
    api.previewComplimentaryInvitation.mockResolvedValue({
      status: "accepted",
      complimentary_premium_until: "2026-12-01T00:00:00Z",
    });
    renderInvite();
    expect(await screen.findByText("FlowSight Premium activated")).toBeInTheDocument();
    expect(
      screen.getByText(/complimentary Premium access is active through December 1, 2026/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to FlowSight" })).toBeInTheDocument();
  });
});
