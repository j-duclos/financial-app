import { describe, expect, it } from "vitest";
import { FINANCIAL_QUERY_PREFIXES } from "@/lib/financialQueryRefresh";

describe("financialQueryRefresh", () => {
  it("includes transactions and accounts query prefixes for mutation invalidation", () => {
    const flat = FINANCIAL_QUERY_PREFIXES.map((k) => k[0]);
    expect(flat).toContain("transactions");
    expect(flat).toContain("accounts");
    expect(flat).toContain("dashboard-summary-fast");
    expect(flat).toContain("rules");
    expect(flat).toContain("calendar-chunk");
    expect(flat).toContain("spending-targets");
    expect(flat).toContain("monthly-reports");
  });
});
