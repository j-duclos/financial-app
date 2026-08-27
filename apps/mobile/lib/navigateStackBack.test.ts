import { describe, expect, it, vi } from "vitest";
import { navigateStackBack, SECONDARY_SCREEN_BACK_FALLBACK } from "./navigateStackBack";

describe("navigateStackBack", () => {
  it("calls router.back when navigation history exists", () => {
    const back = vi.fn();
    const replace = vi.fn();
    navigateStackBack({ back, replace }, { canGoBack: () => true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces with More fallback when there is no history", () => {
    const back = vi.fn();
    const replace = vi.fn();
    navigateStackBack({ back, replace }, { canGoBack: () => false });
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(SECONDARY_SCREEN_BACK_FALLBACK);
  });

  it("supports a custom fallback href", () => {
    const replace = vi.fn();
    navigateStackBack({ back: vi.fn(), replace }, { canGoBack: () => false }, "/goals");
    expect(replace).toHaveBeenCalledWith("/goals");
  });
});
