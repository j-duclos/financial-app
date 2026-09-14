import { describe, expect, it } from "vitest";
import { APP_WEB_URL } from "./branding";
import {
  DEFAULT_PRIVACY_POLICY_URL,
  DEFAULT_TERMS_OF_SERVICE_URL,
  resolveLegalUrl,
} from "./legalUrls";

describe("legal URLs", () => {
  it("points production defaults at flowsight360.com", () => {
    expect(DEFAULT_PRIVACY_POLICY_URL).toBe(`${APP_WEB_URL}/privacy`);
    expect(DEFAULT_TERMS_OF_SERVICE_URL).toBe(`${APP_WEB_URL}/terms`);
    expect(DEFAULT_PRIVACY_POLICY_URL).toMatch(/^https:\/\/flowsight360\.com\/privacy$/);
    expect(DEFAULT_TERMS_OF_SERVICE_URL).toMatch(/^https:\/\/flowsight360\.com\/terms$/);
  });

  it("prefers an explicit override and falls back when empty", () => {
    expect(resolveLegalUrl(" https://example.test/privacy ", DEFAULT_PRIVACY_POLICY_URL)).toBe(
      "https://example.test/privacy"
    );
    expect(resolveLegalUrl("", DEFAULT_TERMS_OF_SERVICE_URL)).toBe(DEFAULT_TERMS_OF_SERVICE_URL);
    expect(resolveLegalUrl(null, DEFAULT_PRIVACY_POLICY_URL)).toBe(DEFAULT_PRIVACY_POLICY_URL);
  });
});
