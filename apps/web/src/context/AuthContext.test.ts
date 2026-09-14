import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const authSource = readFileSync(join(dir, "AuthContext.tsx"), "utf8");
const appSource = readFileSync(join(dir, "../App.tsx"), "utf8");

describe("web unauthorized handling", () => {
  it("wires onUnauthorized to logout after terminal refresh failure", () => {
    expect(authSource).toMatch(/onUnauthorized:\s*\(\)\s*=>\s*\{/);
    expect(authSource).toMatch(/logoutRef\.current\(\)/);
    expect(authSource).toMatch(/clearWebAuthStorage/);
    expect(authSource).toMatch(/queryClient\.clear\(\)/);
    expect(authSource).toMatch(/wireApiClient\(\)/);
  });

  it("does not treat login/register public failures as session expiry", () => {
    expect(authSource).toMatch(/apiLogin/);
    expect(authSource).toMatch(/apiRegister/);
    expect(authSource).not.toMatch(/onUnauthorized:\s*logout/);
  });

  it("hides protected UI when access is cleared", () => {
    expect(appSource).toMatch(/resolveProtectedAuthGate/);
    expect(appSource).toMatch(/Navigate to="\/login"/);
  });
});
