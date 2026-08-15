import { describe, expect, it } from "vitest";
import { clientPasswordErrors, passwordApiFieldErrors } from "./profilePassword";

describe("clientPasswordErrors", () => {
  it("requires current, new, matching confirmation, and minimum length", () => {
    expect(clientPasswordErrors({ currentPassword: "", newPassword: "", confirmPassword: "" })).toEqual({
      current: "Enter your current password.",
      next: "Enter a new password.",
      confirm: "Confirm the new password.",
    });
    expect(
      clientPasswordErrors({
        currentPassword: "oldpass1",
        newPassword: "short",
        confirmPassword: "short",
      })?.next
    ).toMatch(/at least 8/);
    expect(
      clientPasswordErrors({
        currentPassword: "oldpass1",
        newPassword: "newpass12",
        confirmPassword: "otherpass",
      })?.confirm
    ).toMatch(/do not match/);
    expect(
      clientPasswordErrors({
        currentPassword: "oldpass1",
        newPassword: "newpass12",
        confirmPassword: "newpass12",
      })
    ).toBeNull();
  });
});

describe("passwordApiFieldErrors", () => {
  it("maps backend messages onto fields without echoing secrets", () => {
    expect(passwordApiFieldErrors("Current password is incorrect.").current).toMatch(/incorrect/);
    expect(passwordApiFieldErrors("new_password: This password is too common.").next).toMatch(
      /too common/
    );
    expect(passwordApiFieldErrors("new_password_confirm: New passwords do not match.").confirm).toMatch(
      /do not match/
    );
  });
});
