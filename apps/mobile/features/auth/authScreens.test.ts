import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const registerSource = readFileSync(join(dir, "../../app/(auth)/register.tsx"), "utf8");
const loginSource = readFileSync(join(dir, "../../app/(auth)/login.tsx"), "utf8");

describe("auth screens autofill", () => {
  it("register marks username, email, and new-password for the system Autofill service", () => {
    expect(registerSource).toMatch(/autoComplete="username"/);
    expect(registerSource).toMatch(/autoComplete="email"/);
    expect(registerSource).toMatch(/autoComplete="password-new"/);
    expect(registerSource).toMatch(/textContentType="username"/);
    expect(registerSource).toMatch(/textContentType="emailAddress"/);
    expect(registerSource).toMatch(/textContentType="newPassword"/);
  });

  it("login keeps username and password Autofill hints", () => {
    expect(loginSource).toMatch(/autoComplete="username"/);
    expect(loginSource).toMatch(/autoComplete="password"/);
  });
});
