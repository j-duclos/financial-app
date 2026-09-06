/** Central legal/product-safety copy. Production identity comes from env vars. */

export const SHORT_FINANCIAL_DISCLAIMER =
  "Financial forecasts and insights are estimates for informational purposes only and are not financial, investment, tax, legal, or accounting advice.";

export const FOOTER_FINANCIAL_NOTE = "Financial information is for planning purposes only.";

export const LEGAL_LAST_UPDATED = "September 5, 2026";
export const LEGAL_LAST_UPDATED_ISO = "2026-09-05";

export type LegalConfig = {
  productName: string;
  businessName: string | null;
  operatorLabel: string;
  contactEmail: string | null;
  state: string;
  lastUpdated: string;
  lastUpdatedIso: string;
};

function envTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getLegalConfig(): LegalConfig {
  const productName = envTrim(import.meta.env.VITE_LEGAL_PRODUCT_NAME) || "Financial App";
  const businessName = envTrim(import.meta.env.VITE_LEGAL_BUSINESS_NAME) || null;
  const contactEmail = envTrim(import.meta.env.VITE_LEGAL_CONTACT_EMAIL) || null;
  const state = envTrim(import.meta.env.VITE_LEGAL_STATE) || "Arizona";
  return {
    productName,
    businessName,
    operatorLabel: businessName ?? "the operator of this application",
    contactEmail,
    state,
    lastUpdated: LEGAL_LAST_UPDATED,
    lastUpdatedIso: LEGAL_LAST_UPDATED_ISO,
  };
}
