import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatLinkedMinimumLine } from "./dtiDisplay";
import { formatMinimumPaymentSourceLine } from "./minimumPaymentDisplay";

const fieldsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/accounts/CreditMinimumPaymentFields.tsx"),
  "utf8"
);
const accountsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Accounts.tsx"),
  "utf8"
);

describe("minimum payment UI guardrails", () => {
  it("does not estimate an issuer minimum from card balance", () => {
    expect(fieldsSource).not.toMatch(/balance\s*\*\s*0\.02/);
    expect(accountsSource).not.toMatch(/minimum.*balance\s*\*/i);
  });

  it("does not create recurring rules when the minimum source changes", () => {
    expect(accountsSource).not.toMatch(/createRecurringRule/);
    expect(fieldsSource).not.toMatch(/RecurringRule/);
  });

  it("formats linked DTI minimums with source and freshness", () => {
    expect(
      formatLinkedMinimumLine({
        minimum_payment_amount: "86.00",
        minimum_payment_source: "plaid",
        minimum_payment_freshness: "fresh",
      })
    ).toBe("$86.00/month — synced from institution");
    expect(
      formatLinkedMinimumLine({
        minimum_payment_amount: "100.00",
        minimum_payment_source: "manual",
        minimum_payment_freshness: "manual",
      })
    ).toBe("$100.00/month — manually entered");
    expect(
      formatMinimumPaymentSourceLine({
        minimum_payment_amount: null,
        minimum_payment_source: "none",
        minimum_payment_freshness: "unavailable",
      })
    ).toBe("Minimum unavailable — enter manually");
  });
});
