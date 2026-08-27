import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { clearUserQueryCache } from "./clearUserQueryCache";
import { PROFILE_QUERY_KEY } from "./profileQueryKey";

describe("clearUserQueryCache", () => {
  it("removes profile and financial queries on logout", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(PROFILE_QUERY_KEY, { id: 1 });
    queryClient.setQueryData(["dashboard-summary-fast", 30], { ok: true });
    queryClient.setQueryData(["households"], [{ id: 1 }]);
    queryClient.setQueryData(["what-if-scenarios"], [{ id: 1 }]);

    queryClient.setQueryData(["account-options", 1], [{ id: 1 }]);
    queryClient.setQueryData(["category-options", 1], [{ id: 1 }]);

    clearUserQueryCache(queryClient);

    expect(queryClient.getQueryData(["account-options", 1])).toBeUndefined();
    expect(queryClient.getQueryData(["category-options", 1])).toBeUndefined();
    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
    expect(queryClient.getQueryData(["dashboard-summary-fast", 30])).toBeUndefined();
    expect(queryClient.getQueryData(["households"])).toBeUndefined();
    expect(queryClient.getQueryData(["what-if-scenarios"])).toBeUndefined();
  });
});
