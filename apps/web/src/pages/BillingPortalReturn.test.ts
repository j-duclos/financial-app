import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLOWSIGHT_APP_PROFILE_HREF } from "./BillingPortalReturn";

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, "BillingPortalReturn.tsx"), "utf8");
const appSource = readFileSync(join(dir, "../App.tsx"), "utf8");

describe("Stripe portal return", () => {
  it("is a public route that does not send unauthenticated users to login", () => {
    expect(appSource).toMatch(/path="\/billing\/return"/);
    expect(appSource).toMatch(/BillingPortalReturn/);
    expect(appSource).toMatch(/<Route path="\/billing\/return" element=\{<BillingPortalReturn \/>\} \/>/);
    expect(pageSource).toMatch(/Navigate to="\/profile\?billing=portal"/);
    expect(pageSource).not.toMatch(/\/login/);
    expect(FLOWSIGHT_APP_PROFILE_HREF).toBe("budgetapp://profile");
  });
});
