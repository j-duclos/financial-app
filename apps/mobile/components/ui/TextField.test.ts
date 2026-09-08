import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "TextField.tsx"),
  "utf8"
);

describe("TextField", () => {
  it("keeps Android Autofill off so the system toolbar cannot cover the field", () => {
    expect(source).toMatch(/noExcludeDescendants/);
    expect(source).toMatch(/autoComplete=\{android \? "off" : autoComplete\}/);
    expect(source).toMatch(/disableFullscreenUI=\{android\}/);
    expect(source).toMatch(/showSoftInputOnFocus/);
    expect(source).toMatch(/underlineColorAndroid="transparent"/);
    expect(source).toMatch(/textAlignVertical="center"/);
  });
});
