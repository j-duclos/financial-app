import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const categoriesSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Categories.tsx"),
  "utf8"
);

describe("Categories page", () => {
  it("exports Categories component", async () => {
    const mod = await import("./Categories");
    expect(typeof mod.default).toBe("function");
  });

  it("keeps Expense/Income tabs, search, archived visibility, and add", () => {
    expect(categoriesSource).toMatch(/Expense/);
    expect(categoriesSource).toMatch(/Income/);
    expect(categoriesSource).toMatch(/Search categories/);
    expect(categoriesSource).toMatch(/Show archived/);
    expect(categoriesSource).toMatch(/Add category/);
  });

  it("filters All / Custom / Default from is_system", () => {
    expect(categoriesSource).toMatch(/All/);
    expect(categoriesSource).toMatch(/Custom/);
    expect(categoriesSource).toMatch(/Default/);
    expect(categoriesSource).toMatch(/filterManagedCategories/);
    expect(categoriesSource).toMatch(/source === "all"/);
  });

  it("loads one category list and filters locally", () => {
    expect(categoriesSource).toMatch(/useCategories/);
    expect(categoriesSource).toMatch(/includeArchived: true/);
    expect(categoriesSource).not.toMatch(/queryKey: \["categories", \{ household/);
  });

  it("uses a compact table with discoverable row actions", () => {
    expect(categoriesSource).toMatch(/CategoryActionsMenu/);
    expect(categoriesSource).toMatch(/<table/);
    expect(categoriesSource).toMatch(/onRestore/);
    expect(categoriesSource).toMatch(/Delete this category\?/);
  });
});
