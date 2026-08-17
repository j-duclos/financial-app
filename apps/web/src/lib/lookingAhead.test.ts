import { describe, expect, it } from "vitest";
import type { ExtendedCashRisk, ExtendedCashRiskResponse } from "@budget-app/shared";
import {
  isLookingAheadVisible,
  lookingAheadCalendarPath,
  lookingAheadMessage,
} from "./lookingAhead";

const risk: ExtendedCashRisk = {
  account_id: 1,
  account_name: "Main",
  first_negative_date: "2026-09-23",
  projected_balance: "-12.50",
  days_from_as_of: 38,
  additional_accounts: [],
};

const payload: ExtendedCashRiskResponse = {
  as_of: "2026-08-16",
  horizon_days: 180,
  risk,
};

describe("lookingAhead", () => {
  it("shows the warning only when the shortfall is beyond the selected window", () => {
    expect(isLookingAheadVisible(payload, 30)).toBe(true);
    expect(isLookingAheadVisible(payload, 60)).toBe(false);
    expect(isLookingAheadVisible({ ...payload, risk: null }, 30)).toBe(false);
    expect(
      isLookingAheadVisible(
        { ...payload, risk: { ...risk, days_from_as_of: 10 } },
        30
      )
    ).toBe(false);
  });

  it("does not key visibility on a missing payload", () => {
    expect(isLookingAheadVisible(undefined, 30)).toBe(false);
  });

  it("builds the looking-ahead sentence and calendar link", () => {
    expect(lookingAheadMessage(risk)).toBe(
      "Main is projected to fall below $0 on Sep 23, 38 days from now."
    );
    expect(lookingAheadCalendarPath(risk, "2026-08-16")).toBe(
      "/timeline?date=2026-09-23&horizon=3m"
    );
  });

  it("mentions a second same-day account without listing a long set", () => {
    expect(
      lookingAheadMessage({
        ...risk,
        additional_accounts: [
          { account_id: 2, account_name: "Bills", projected_balance: "-5.00" },
        ],
      })
    ).toBe("Main and Bills are projected to fall below $0 on Sep 23, 38 days from now.");
    expect(
      lookingAheadMessage({
        ...risk,
        additional_accounts: [
          { account_id: 2, account_name: "Bills", projected_balance: "-5.00" },
          { account_id: 3, account_name: "Reserve", projected_balance: "-1.00" },
        ],
      })
    ).toBe("Main and 2 other accounts are projected to fall below $0 on Sep 23, 38 days from now.");
  });
});
