import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountCreateApiPayload,
  validateAccountOnboardingForm,
} from "./accountOnboardingForm";

const dir = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(dir, "AccountFormScreen.tsx"), "utf8");

describe("mobile account onboarding form", () => {
  it("does not require a separate Display Name field", () => {
    expect(formSource).toMatch(/Account name/);
    expect(formSource).toMatch(/Bank \/ institution \(optional\)/);
    expect(formSource).not.toMatch(/label="Display name"/);
    expect(formSource).not.toMatch(/label="Name"/);
    expect(formSource).toMatch(/singleHouseholdIdIfUnambiguous/);
    expect(formSource).not.toMatch(/households\[0\]\?\.id/);
  });

  it("maps checking starting balance onto existing API fields", () => {
    const payload = accountCreateApiPayload(
      {
        name: "Main Checking",
        institution: "Chase",
        account_type: "CHECKING",
        starting_balance: "1000.00",
        credit_limit: "",
      },
      9
    );
    expect(payload).toEqual({
      household: 9,
      name: "Main Checking",
      display_name: "",
      institution: "Chase",
      account_type: "CHECKING",
      starting_balance: "1000.00",
      credit_limit: null,
    });
    expect(validateAccountOnboardingForm({
      name: "Main Checking",
      institution: "Chase",
      account_type: "CHECKING",
      starting_balance: "1000.00",
      credit_limit: "",
    })).toEqual({});
  });

  it("sends credit owed as starting_balance and limit as credit_limit", () => {
    const payload = accountCreateApiPayload(
      {
        name: "Visa",
        institution: "Chase",
        account_type: "CREDIT",
        starting_balance: "926.24",
        credit_limit: "5000.00",
      },
      9
    );
    expect(payload.starting_balance).toBe("926.24");
    expect(payload.credit_limit).toBe("5000.00");
    expect(formSource).toMatch(/Current balance owed/);
    expect(formSource).toMatch(/Credit limit/);
  });
});
