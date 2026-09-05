import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteScenarioGuidedStrategy,
  getScenarioGuidedStrategy,
  saveScenarioGuidedStrategy,
} from "./api";
import { ApiError, configureApiClient } from "./config";
import type { ScenarioGuidedStrategy, ScenarioGuidedStrategyWritePayload } from "@budget-app/shared";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

const strategy: ScenarioGuidedStrategy = {
  id: 1,
  scenario_id: 12,
  strategy_type: "debt_first_vs_save_first",
  source_account: {
    id: 1,
    name: "Checking Source",
    effective_display_name: "Checking Source",
    account_type: "CHECKING",
  },
  savings_account: {
    id: 4,
    name: "Savings Dest",
    effective_display_name: "Savings Dest",
    account_type: "SAVINGS",
  },
  included_debt_accounts: [
    {
      id: 7,
      name: "Card A",
      effective_display_name: "Card A",
      account_type: "CREDIT",
    },
  ],
  savings_transfer_rules: [
    {
      id: 21,
      name: "Savings transfer",
      account_id: 1,
      transfer_to_account_id: 4,
    },
  ],
  start_date: "2026-09-05",
  minimum_cash_buffer: "500.00",
  allocation_percent: "100.00",
  payoff_strategy: "avalanche",
  custom_debt_order: [],
  resume_savings_after_payoff: true,
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
};

const writePayload: ScenarioGuidedStrategyWritePayload = {
  strategy_type: "debt_first_vs_save_first",
  source_account_id: 1,
  savings_account_id: 4,
  included_debt_account_ids: [7],
  savings_transfer_rule_ids: [21],
  start_date: "2026-09-05",
  minimum_cash_buffer: "500.00",
  allocation_percent: "100.00",
  payoff_strategy: "avalanche",
  custom_debt_order_ids: [],
  resume_savings_after_payoff: true,
};

describe("scenario guided strategy API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureApiClient({ baseUrl: "http://test.local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/scenarios/{id}/guided-strategy/", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, strategy));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getScenarioGuidedStrategy(12);
    expect(result.scenario_id).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/scenarios/12/guided-strategy/");
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("PUTs the write payload and returns the normalized strategy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, strategy));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveScenarioGuidedStrategy(12, writePayload);
    expect(result.id).toBe(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(writePayload);
  });

  it("DELETEs the guided strategy without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      text: async () => "",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await deleteScenarioGuidedStrategy(12);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/scenarios/12/guided-strategy/");
  });

  it("surfaces GET 404 as ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { detail: "Not found." }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getScenarioGuidedStrategy(12)).rejects.toBeInstanceOf(ApiError);
  });
});
