/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";

function Boom(): never {
  throw new Error("secret stack should stay hidden in production");
}

afterEach(() => {
  cleanup();
});

describe("AppErrorBoundary", () => {
  it("renders a safe fallback without changing financial data copy", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );
    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong." })).toBeInTheDocument();
    expect(screen.getByText("Your financial data has not been changed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to Dashboard" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
