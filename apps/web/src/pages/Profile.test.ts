import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const profileSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Profile.tsx"),
  "utf8"
);

describe("Profile page", () => {
  it("exports Profile component", async () => {
    const mod = await import("./Profile");
    expect(typeof mod.default).toBe("function");
  });

  it("groups Profile, Defaults, and Security", () => {
    expect(profileSource).toMatch(/>Profile</);
    expect(profileSource).toMatch(/>Defaults</);
    expect(profileSource).toMatch(/>Security</);
    expect(profileSource).not.toMatch(/>Account</);
  });

  it("treats username as a read-only identifier", () => {
    expect(profileSource).toMatch(/readOnly/);
    expect(profileSource).toMatch(/cannot be changed/);
    expect(profileSource).toMatch(/autoComplete="username"/);
    expect(profileSource).not.toMatch(/setUsername/);
  });

  it("marks display name optional and shown in the header", () => {
    expect(profileSource).toMatch(/Shown in the header/);
    expect(profileSource).toMatch(/Optional/);
  });

  it("formats phone input without asking the user for E.164", () => {
    expect(profileSource).toMatch(/formatPhoneInput/);
    expect(profileSource).toMatch(/formatPhoneForDisplay/);
    expect(profileSource).toMatch(/Plaid\/bank verification text messages/);
    expect(profileSource).not.toMatch(/Saved as E\.164/);
  });

  it("filters default accounts locally when household changes", () => {
    expect(profileSource).toMatch(/useOperationalAccounts/);
    expect(profileSource).toMatch(/accountsForHousehold/);
    expect(profileSource).toMatch(/nextDefaultAccountId/);
    expect(profileSource).not.toMatch(/listAccounts\(\{ household/);
  });

  it("saves profile independently from password", () => {
    expect(profileSource).toMatch(/handleSaveProfile/);
    expect(profileSource).toMatch(/handleChangePassword/);
    expect(profileSource).toMatch(/Profile saved\./);
    expect(profileSource).toMatch(/Password updated\./);
    expect(profileSource).toMatch(/invalidateQueries\(\{ queryKey: \["profile"\] \}\)/);
    expect(profileSource).toMatch(/refreshUser/);
    expect(profileSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["timeline"\]/);
    expect(profileSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["dashboard/);
  });

  it("validates password confirmation and show/hide controls", () => {
    expect(profileSource).toMatch(/clientPasswordErrors/);
    expect(profileSource).toMatch(/Hide /);
    expect(profileSource).toMatch(/Show /);
    expect(profileSource).toMatch(/setCurrentPassword\(""\)/);
    expect(profileSource).toMatch(/setNewPassword\(""\)/);
    expect(profileSource).toMatch(/setConfirmPassword\(""\)/);
    expect(profileSource).toMatch(/changePasswordMu.isPending/);
    expect(profileSource).toMatch(/saveProfileMu.isPending/);
    expect(profileSource).toMatch(/autoComplete="current-password"/);
    expect(profileSource).toMatch(/autoComplete="new-password"/);
  });
});
