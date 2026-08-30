import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Goals.tsx"),
  "utf8"
);

describe("Goals page", () => {
  it("uses Add goal and does not open a forecast modal", () => {
    expect(source).toMatch(/>\s*Add goal\s*</);
    expect(source).not.toMatch(/Add goal bucket/);
    expect(source).not.toMatch(/ForecastModal/);
    expect(source).not.toMatch(/onForecast/);
  });

  it("opens the edit modal from the Goal Details edit query param", () => {
    expect(source).toMatch(/searchParams\.get\("edit"\)/);
    expect(source).toMatch(/setEditing\(match\)/);
  });

  it("uses intent-specific invalidation instead of a universal blast", () => {
    expect(source).toMatch(/invalidateGoalLifecycleQueries/);
    expect(source).toMatch(/classifyGoalSaveImpact/);
    expect(source).toMatch(/invalidateAfterGoalSave/);
    expect(source).not.toMatch(/const invalidate = \(\) => \{/);
  });

  it("lifecycle mutations share targeted lifecycle invalidation", () => {
    expect(source).toMatch(
      /archiveMu = useMutation\(\{ mutationFn: archiveBucket, onSuccess: invalidateLifecycle \}/
    );
    expect(source).toMatch(
      /completeMu = useMutation\(\{ mutationFn: completeBucket, onSuccess: invalidateLifecycle \}/
    );
    expect(source).toMatch(
      /pauseMu = useMutation\(\{ mutationFn: pauseBucket, onSuccess: invalidateLifecycle \}/
    );
    expect(source).toMatch(
      /duplicateMu = useMutation\(\{ mutationFn: duplicateBucket, onSuccess: invalidateLifecycle \}/
    );
  });
});
