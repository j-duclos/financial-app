import { describe, expect, it } from "vitest";
import { PAGE_SHELL, PAGE_SHELL_PY } from "./pageLayout";

describe("pageLayout", () => {
  it("uses full width with shared horizontal gutters", () => {
    expect(PAGE_SHELL).toContain("w-full");
    expect(PAGE_SHELL).toContain("lg:px-8");
    expect(PAGE_SHELL_PY).toContain(PAGE_SHELL);
  });
});
