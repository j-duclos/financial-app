import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountFieldLabel,
  canonicalCreateAmount,
  createTransactionButtonLabel,
  payeeOrSourceLabel,
  transferAmount,
  validateTransactionForm,
} from "./transactionForm";

const dir = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(dir, "TransactionFormScreen.tsx"), "utf8");

describe("transaction form type-specific copy", () => {
  it("changes labels and primary button by transaction type", () => {
    expect(payeeOrSourceLabel("expense")).toBe("Payee");
    expect(payeeOrSourceLabel("income")).toBe("Source");
    expect(accountFieldLabel("transfer")).toBe("From account");
    expect(createTransactionButtonLabel("expense", false)).toBe("Create expense");
    expect(createTransactionButtonLabel("income", false)).toBe("Create income");
    expect(createTransactionButtonLabel("transfer", false)).toBe("Create transfer");
    expect(formSource).toMatch(/Transaction type/);
    expect(formSource).toMatch(/createTransfer\(/);
    expect(formSource).toMatch(/sanitizeUnsignedMoneyInput/);
    expect(formSource).toMatch(/keyboardType="decimal-pad"/);
  });
});

describe("transaction form validation and canonical amounts", () => {
  it("accepts 47.82 and signs expense vs income using existing convention", () => {
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "47.82",
      })
    ).toEqual({});
    expect(canonicalCreateAmount("expense", "47.82")).toBe("-47.82");
    expect(canonicalCreateAmount("income", "47.82")).toBe("47.82");
    expect(transferAmount("47.82")).toBe("47.82");
  });

  it("rejects Gasoline, zero, and missing required fields", () => {
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "Gasoline",
      }).amount
    ).toMatch(/valid/i);
    expect(
      validateTransactionForm({
        entryType: "income",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "0",
      }).amount
    ).toMatch(/greater than 0/);
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: "",
        transferToAccountId: "",
        dateIso: "",
        amount: "",
      })
    ).toMatchObject({
      account_id: "Account is required.",
      dateIso: "Date is required.",
    });
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "-47.82",
      }).amount
    ).toMatch(/valid/i);
  });

  it("requires distinct transfer source and destination and uses createTransfer", () => {
    expect(
      validateTransactionForm({
        entryType: "transfer",
        accountId: 3,
        transferToAccountId: 3,
        dateIso: "2026-09-07",
        amount: "25.00",
      }).transfer_to_account_id
    ).toMatch(/different accounts/);
    expect(
      validateTransactionForm({
        entryType: "transfer",
        accountId: 3,
        transferToAccountId: 4,
        dateIso: "2026-09-07",
        amount: "25.00",
      })
    ).toEqual({});
    expect(formSource).toMatch(/from_account: form.account_id/);
    expect(formSource).toMatch(/to_account: form.transfer_to_account_id/);
    expect(formSource).not.toMatch(/createTransaction\(body\).*createTransaction\(body\)/s);
  });
});
