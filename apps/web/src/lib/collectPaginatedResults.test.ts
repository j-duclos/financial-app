import { describe, expect, it, vi } from "vitest";
import { collectPaginatedResults } from "./collectPaginatedResults";

describe("collectPaginatedResults", () => {
  it("follows next pages instead of stopping at the first page", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) {
        return { results: [{ id: 1 }, { id: 2 }], next: "/api/transactions/?page=2" };
      }
      return { results: [{ id: 3 }], next: null };
    });
    await expect(collectPaginatedResults(fetchPage)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("returns the first page when there is no next link", async () => {
    await expect(
      collectPaginatedResults(async () => ({ results: [{ id: 9 }], next: null }))
    ).resolves.toEqual([{ id: 9 }]);
  });
});
