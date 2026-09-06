/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlanBadge from "./PlanBadge";

describe("PlanBadge", () => {
  it("renders Free and Premium labels", () => {
    const { rerender } = render(<PlanBadge plan="FREE" />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    rerender(<PlanBadge plan="PREMIUM" />);
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });
});
