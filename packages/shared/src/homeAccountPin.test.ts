import { describe, expect, it } from "vitest";
import {
  HOME_ACCOUNT_PIN_INACTIVE_MESSAGE,
  HOME_ACCOUNT_PIN_LIMIT,
  HOME_ACCOUNT_PIN_LIMIT_MESSAGE,
} from "./homeAccountPin";

describe("homeAccountPin", () => {
  it("exports the household Home pin limit and client/server copy", () => {
    expect(HOME_ACCOUNT_PIN_LIMIT).toBe(4);
    expect(HOME_ACCOUNT_PIN_LIMIT_MESSAGE).toBe(
      "You can pin up to 4 accounts to Home. Unpin one first."
    );
    expect(HOME_ACCOUNT_PIN_INACTIVE_MESSAGE).toBe("Only active accounts can be pinned to Home.");
  });
});
