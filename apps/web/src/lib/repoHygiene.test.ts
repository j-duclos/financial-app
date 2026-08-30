import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("repo hygiene — Python cache artifacts", () => {
  it(".gitignore covers Python bytecode patterns", () => {
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/__pycache__\//);
    expect(gitignore).toMatch(/\*\.py\[cod\]/);
  });

  it("does not track __pycache__ or .pyc files", () => {
    const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const cacheArtifacts = tracked.filter(
      (p) => p.includes("__pycache__") || /\.py[cod]$/.test(p)
    );
    expect(cacheArtifacts).toEqual([]);
  });
});
