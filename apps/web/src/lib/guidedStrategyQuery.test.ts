import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureApiClient } from "@budget-app/api-client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchScenarioGuidedStrategyOrNull,
  isGuidedStrategyNotConfiguredError,
} from "./guidedStrategyQuery";

const hookSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../hooks/useScenarioGuidedStrategy.ts"),
  "utf8"
);
const scenariosSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Scenarios.tsx"),
  "utf8"
);

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("guided strategy query handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureApiClient({ baseUrl: "http://test.local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats GET 404 as not configured", async () => {
    expect(isGuidedStrategyNotConfiguredError(new ApiError(404, "Not found."))).toBe(true);
    expect(isGuidedStrategyNotConfiguredError(new ApiError(500, "Server error"))).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { detail: "Not found." })));
    await expect(fetchScenarioGuidedStrategyOrNull(12)).resolves.toBeNull();
  });

  it("rethrows non-404 failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { detail: "Boom" })));
    await expect(fetchScenarioGuidedStrategyOrNull(12)).rejects.toMatchObject({ status: 500 });
  });

  it("wires the 404 helper into the guided-strategy hook", () => {
    expect(hookSource).toMatch(/fetchScenarioGuidedStrategyOrNull/);
    expect(hookSource).toMatch(/whatIfWebQueryKeys\.guidedStrategy/);
  });

  it("invalidates only the guided-strategy query after save or delete", () => {
    expect(scenariosSource).toMatch(/whatIfWebQueryKeys\.guidedStrategy/);
    expect(scenariosSource).toMatch(/deleteScenarioGuidedStrategy/);
    expect(scenariosSource).toMatch(/setQueryData\(/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["dashboard/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["transactions/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["calendar/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["goals/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["rules/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: OPERATIONAL_ACCOUNTS/);
  });
});
