import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatPlaidDiagnosticLog,
  payloadLooksSensitive,
  PlaidLinkExitError,
  plaidExitUserMessage,
  shouldLogPlaidLinkEvent,
  summarizePlaidExit,
  summarizePlaidLinkEvent,
} from "./plaidLinkDiagnostics";

describe("Plaid Link exit diagnostics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves errorCode and requestId on PlaidLinkExitError", () => {
    const err = new PlaidLinkExitError({
      errorCode: "INVALID_LINK_TOKEN",
      errorType: "INVALID_INPUT",
      displayMessage: "Something went wrong",
      errorMessage: "link token expired",
      institutionId: "ins_128026",
      institutionName: "Capital One",
      requestId: "req-abc",
      status: "requires_oauth",
    });
    expect(err.errorCode).toBe("INVALID_LINK_TOKEN");
    expect(err.requestId).toBe("req-abc");
    expect(err.userMessage).toBe("Something went wrong");
    expect(err.message).toBe("Something went wrong");
  });

  it("keeps user-facing copy free of request ids", () => {
    expect(
      plaidExitUserMessage({
        errorCode: "OAUTH_ERROR",
        requestId: "req-secret-debug",
      })
    ).toBe("Bank linking didn’t finish. Try again.");
    expect(plaidExitUserMessage({ requestId: "req-1" })).not.toMatch(/req-/);
  });

  it("does not treat Plaid ITEM_LOCKED as the bank account being locked", () => {
    const msg = plaidExitUserMessage({
      errorCode: "ITEM_LOCKED",
      displayMessage: "Your account is locked. Please visit your financial institution’s website.",
      institutionName: "Capital One",
    });
    expect(msg).toMatch(/ITEM_LOCKED/);
    expect(msg).toMatch(/Plaid/);
    expect(msg).not.toMatch(/visit your financial institution/i);
  });

  it("summarizes exits without tokens or credentials", () => {
    const summary = summarizePlaidExit({
      errorCode: "INVALID_CREDENTIALS",
      requestId: "req-9",
      errorMessage: "public_token leaked",
    });
    expect(summary.errorCode).toBe("INVALID_CREDENTIALS");
    expect(summary.requestId).toBe("req-9");
    expect(summary.errorMessage).toBeUndefined();
    expect(JSON.stringify(summary)).not.toMatch(/public_token/i);
    expect(JSON.stringify(summary)).not.toMatch(/access_token/i);
  });

  it("does not treat credential-like event metadata as loggable", () => {
    expect(payloadLooksSensitive({ public_token: "public-sandbox-x" })).toBe(true);
    expect(payloadLooksSensitive({ access_token: "access-sandbox-x" })).toBe(true);
    expect(payloadLooksSensitive({ errorCode: "INVALID_FIELD" })).toBe(false);
  });

  it("logs OAuth and institution transitions, not unrelated events", () => {
    expect(shouldLogPlaidLinkEvent("OPEN_OAUTH")).toBe(true);
    expect(shouldLogPlaidLinkEvent("CLOSE_OAUTH")).toBe(true);
    expect(shouldLogPlaidLinkEvent("HANDOFF")).toBe(true);
    expect(shouldLogPlaidLinkEvent("SELECT_INSTITUTION")).toBe(true);
    expect(shouldLogPlaidLinkEvent("MATCHED_SELECT_INSTITUTION")).toBe(true);
    expect(shouldLogPlaidLinkEvent("TRANSITION_VIEW")).toBe(false);
    const summary = summarizePlaidLinkEvent({
      eventName: "OPEN_OAUTH",
      metadata: {
        requestId: "req-oauth",
        institutionId: "ins_128026",
        institutionName: "Capital One",
        accountNumberMask: "1234",
        viewName: "OAUTH",
      },
    });
    expect(summary.eventName).toBe("OPEN_OAUTH");
    expect(summary.requestId).toBe("req-oauth");
    expect(summary).not.toHaveProperty("accountNumberMask");
    const line = formatPlaidDiagnosticLog("event", summary);
    expect(line).toMatch(/OPEN_OAUTH/);
    expect(line).not.toMatch(/1234/);
  });
});
