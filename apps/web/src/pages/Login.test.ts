import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const loginSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Login.tsx"), "utf8");

describe("Login page", () => {
  it("shows a post-deletion notice from navigation state", () => {
    expect(loginSource).toMatch(/location.state/);
    expect(loginSource).toMatch(/notice/);
  });
});
