import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncHouseholdLiabilities, syncPlaidItemLiabilities } from "./api";
import { configureApiClient } from "./config";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("Plaid liabilities API client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({
      baseUrl: "http://test.local",
      getAccessToken: () => "token",
      onUnauthorized: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the item liabilities endpoint", async () => {
    const payload = {
      item_id: 12,
      status: "success",
      observed_at: "2026-09-05T20:00:00Z",
      accounts_seen: 1,
      accounts_updated: 1,
      accounts_unchanged: 0,
      accounts_missing_liability: 0,
      warnings: [],
    };
    fetchMock.mockResolvedValue(jsonResponse(200, payload));
    const result = await syncPlaidItemLiabilities(12);
    expect(result.status).toBe("success");
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/plaid/items/12/sync-liabilities/");
  });

  it("posts to the household liabilities endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { household_id: 9, items: [], item_count: 0 })
    );
    const result = await syncHouseholdLiabilities(9);
    expect(result.household_id).toBe(9);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/plaid/sync-liabilities/");
    expect(url).toContain("household=9");
  });
});
