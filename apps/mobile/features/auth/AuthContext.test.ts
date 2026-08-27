import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "AuthContext.tsx"),
  "utf8"
);

const apiSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../services/api.ts"),
  "utf8"
);

describe("AuthContext startup", () => {
  it("does not gate initializing on profile network latency", () => {
    expect(authSource).toMatch(/initializing: false,\s*\n\s*isAuthenticated: true/);
    expect(authSource).toMatch(/fetchAndHydrateProfile/);
    expect(authSource).not.toMatch(/await getProfile\(\)[\s\S]{0,80}initializing: false/);
  });

  it("hydrates the shared profile query cache", () => {
    expect(authSource).toMatch(/PROFILE_QUERY_KEY/);
    expect(authSource).toMatch(/setQueryData\(PROFILE_QUERY_KEY, profile\)/);
  });

  it("clears user-specific React Query cache on logout", () => {
    expect(authSource).toMatch(/clearUserQueryCache/);
  });

  it("wires onUnauthorized through the mobile API client", () => {
    expect(authSource).toMatch(/onUnauthorized/);
    expect(apiSource).toMatch(/onUnauthorized: refs\.onUnauthorized/);
  });
});
