import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "TextField.tsx"),
  "utf8"
);

describe("TextField", () => {
  it("does not invite Android Autofill unless the field opts in with autoComplete", () => {
    expect(source).toMatch(/importantForAutofill/);
    expect(source).toMatch(/rest\.autoComplete \? "yes" : "no"/);
    expect(source).toMatch(/underlineColorAndroid="transparent"/);
    expect(source).toMatch(/textAlignVertical="center"/);
  });
});
