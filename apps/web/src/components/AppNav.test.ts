import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const navSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "AppNav.tsx"),
  "utf8"
);

describe("AppNav", () => {
  it("uses dropdown menus for Planning and More", () => {
    expect(navSource).toMatch(/aria-haspopup="menu"/);
    expect(navSource).toMatch(/Escape/);
    expect(navSource).toMatch(/lg:hidden/);
    expect(navSource).toMatch(/hidden lg:flex/);
  });
});
