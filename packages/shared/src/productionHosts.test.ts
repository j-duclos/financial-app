import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RENDER_HOST,
  PRODUCTION_RENDER_ORIGIN,
  STALE_RENDER_HOSTS,
  isProductionRenderHost,
  isStaleRenderHost,
} from "./productionHosts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("production Render host", () => {
  it("identifies the authoritative host and rejects the retired service", () => {
    expect(PRODUCTION_RENDER_HOST).toBe("financial-app-1-tu0l.onrender.com");
    expect(PRODUCTION_RENDER_ORIGIN).toBe("https://financial-app-1-tu0l.onrender.com");
    expect(isProductionRenderHost(PRODUCTION_RENDER_HOST)).toBe(true);
    expect(isStaleRenderHost("financial-app-5ywr.onrender.com")).toBe(true);
    expect(isStaleRenderHost(PRODUCTION_RENDER_HOST)).toBe(false);
    expect(STALE_RENDER_HOSTS).toContain("financial-app-5ywr.onrender.com");
  });

  it("keeps mobile release profiles on the authoritative host", () => {
    const eas = readFileSync(join(repoRoot, "apps/mobile/eas.json"), "utf8");
    expect(eas).toContain(PRODUCTION_RENDER_ORIGIN);
    expect(eas).not.toContain("financial-app-5ywr.onrender.com");
    expect(eas).not.toMatch(/localhost/);
  });

  it("does not leave the stale Render host in operator scripts", () => {
    const files = [
      "scripts/export-render-env.sh",
      "scripts/render-plaid-keys-checklist.sh",
      "scripts/render-paste-into-dashboard.env",
      "scripts/render-env-restore.env.example",
    ];
    for (const relative of files) {
      const source = readFileSync(join(repoRoot, relative), "utf8");
      expect(source, relative).not.toContain("financial-app-5ywr.onrender.com");
      expect(source, relative).toContain(PRODUCTION_RENDER_HOST);
    }
  });
});
