import { describe, expect, it } from "vitest";
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_NAME_PREFIX,
  APP_NAME_SUFFIX,
  APP_TAGLINE,
  APP_VALUE_STATEMENT,
  APP_WEB_HOST,
  APP_WEB_URL,
  APP_WEB_COMPANION_MESSAGE,
  appDisplayName,
} from "./branding";

describe("branding", () => {
  it("exposes FlowSight identity copy", () => {
    expect(APP_NAME).toBe("FlowSight");
    expect(`${APP_NAME_PREFIX}${APP_NAME_SUFFIX}`).toBe(APP_NAME);
    expect(APP_TAGLINE).toMatch(/money/i);
    expect(APP_VALUE_STATEMENT).toMatch(/cash flow/i);
    expect(APP_DESCRIPTION.length).toBeGreaterThan(20);
    expect(APP_WEB_URL).toBe("https://flowsight.com");
    expect(APP_WEB_HOST).toBe("flowsight.com");
    expect(APP_WEB_URL).toContain(APP_WEB_HOST);
    expect(APP_WEB_COMPANION_MESSAGE).toMatch(/full planning experience/);
  });

  it("labels non-production builds without changing the product name", () => {
    expect(appDisplayName("production")).toBe(APP_NAME);
    expect(appDisplayName(undefined)).toBe(APP_NAME);
    expect(appDisplayName("staging")).toBe("FlowSight (Staging)");
    expect(appDisplayName("development")).toBe("FlowSight (Dev)");
  });
});
