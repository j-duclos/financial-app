import { describe, expect, it } from "vitest";
import { isSensitiveKey, scrubHeaders, scrubSentryEvent, scrubSecretText } from "./sentryScrub";

describe("sentry scrubber", () => {
  it("matches sensitive keys exactly", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("access_token")).toBe(true);
    expect(isSensitiveKey("plaid")).toBe(false);
    expect(isSensitiveKey("compass")).toBe(false);
  });

  it("removes Authorization headers", () => {
    const headers = scrubHeaders({
      Authorization: "Bearer secret-jwt",
      Cookie: "session=abc",
      Accept: "application/json",
    }) as Record<string, string>;
    expect(headers.Authorization).toBe("[Filtered]");
    expect(headers.Cookie).toBe("[Filtered]");
    expect(headers.Accept).toBe("application/json");
  });

  it("removes password and token fields and request bodies", () => {
    const event = scrubSentryEvent({
      user: { id: "9", email: "user@example.com" },
      request: {
        headers: { Authorization: "Bearer abc" },
        data: { password: "hunter2", memo: "Payday" },
        query_string: "token=reset&uid=MQ",
      },
      extra: {
        password: "hunter2",
        access_token: "access-sandbox-abcdefghijklmnopqrstuvwxyz",
        payee: "Acme",
        error_code: "ITEM_LOGIN_REQUIRED",
      },
      exception: {
        values: [{ value: "stripe key sk_test_1234567890abcdef and Bearer eyJhbGciOi.aaa.bbb" }],
      },
    });
    expect(event.user).toEqual({ id: "9" });
    const request = event.request as unknown as {
      headers: { Authorization: string };
      data: string;
      query_string: string;
    };
    expect(request.headers.Authorization).toBe("[Filtered]");
    expect(request.data).toBe("[Filtered]");
    expect(request.query_string).toBe("[Filtered]");
    expect((event.extra as { password: string }).password).toBe("[Filtered]");
    expect((event.extra as { access_token: string }).access_token).toBe("[Filtered]");
    expect((event.extra as { payee: string }).payee).toBe("[Filtered]");
    expect((event.extra as { error_code: string }).error_code).toBe("ITEM_LOGIN_REQUIRED");
    const message = (event.exception as { values: { value: string }[] }).values[0].value;
    expect(message).toContain("[Filtered]");
    expect(message).not.toContain("sk_test_");
    expect(message).not.toContain("Bearer ");
  });

  it("redacts known secret patterns in free text", () => {
    expect(scrubSecretText("token access-production-xyzABC")).toContain("[Filtered]");
    expect(scrubSecretText("whsec_abc123")).toBe("[Filtered]");
  });
});
