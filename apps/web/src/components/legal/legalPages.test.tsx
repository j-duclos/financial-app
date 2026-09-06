/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../context/AuthContext";
import Privacy from "../../pages/Privacy";
import Terms from "../../pages/Terms";
import Register from "../../pages/Register";
import SiteFooter from "./SiteFooter";
import { FOOTER_FINANCIAL_NOTE, SHORT_FINANCIAL_DISCLAIMER } from "../../lib/legalConfig";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithAuth(ui: ReactNode) {
  return render(ui, { wrapper });
}

const dir = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("public legal pages", () => {
  it("renders Privacy Policy", () => {
    renderWithAuth(<Privacy />);
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });

  it("renders Terms of Service", () => {
    renderWithAuth(<Terms />);
    expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });

  it("exposes Privacy and Terms from the public footer", () => {
    renderWithAuth(<SiteFooter />);
    expect(screen.getByText(FOOTER_FINANCIAL_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});

describe("registration acknowledgement", () => {
  it("links Terms of Service and Privacy Policy", () => {
    renderWithAuth(<Register />);
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByText(/By creating an account, you agree to the/)).toBeInTheDocument();
  });
});

describe("legal routes are public", () => {
  it("registers /privacy and /terms outside ProtectedRoute", () => {
    const appSource = readFileSync(join(dir, "../../App.tsx"), "utf8");
    const privacyIdx = appSource.indexOf('path="/privacy"');
    const termsIdx = appSource.indexOf('path="/terms"');
    const catchAllIdx = appSource.indexOf('path="*"');
    expect(privacyIdx).toBeGreaterThan(-1);
    expect(termsIdx).toBeGreaterThan(-1);
    expect(privacyIdx).toBeLessThan(catchAllIdx);
    expect(termsIdx).toBeLessThan(catchAllIdx);
    expect(appSource).toMatch(/path="\/privacy"[\s\S]*element=\{<Privacy/);
    expect(appSource).toMatch(/path="\/terms"[\s\S]*element=\{<Terms/);
  });
});

describe("in-app legal discovery and disclaimers", () => {
  it("exposes Privacy and Terms from authenticated Settings", () => {
    const profile = readFileSync(join(dir, "../../pages/Profile.tsx"), "utf8");
    expect(profile).toMatch(/settings-legal-section/);
    expect(profile).toMatch(/LegalPolicyLinks/);
  });

  it("places the short financial disclaimer on planning surfaces", () => {
    const files = [
      "../../pages/Dashboard.tsx",
      "../../pages/CreditCards.tsx",
      "../../pages/Scenarios.tsx",
      "../../pages/DebtToIncome.tsx",
      "../../pages/Reports.tsx",
    ];
    for (const relative of files) {
      const source = readFileSync(join(dir, relative), "utf8");
      expect(source, relative).toMatch(/FinancialDisclaimer/);
    }
    expect(SHORT_FINANCIAL_DISCLAIMER).toMatch(/informational purposes only/);
  });
});

describe("router smoke for legal paths", () => {
  it("renders privacy and terms through Routes", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/privacy"]}>
          <AuthProvider>
            <Routes>
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
  });
});
