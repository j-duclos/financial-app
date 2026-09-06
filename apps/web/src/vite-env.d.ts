/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_PERF_LOGS?: string;
  readonly VITE_PLAID_REDIRECT_URI?: string;
  readonly VITE_LEGAL_PRODUCT_NAME?: string;
  readonly VITE_LEGAL_BUSINESS_NAME?: string;
  readonly VITE_LEGAL_CONTACT_EMAIL?: string;
  readonly VITE_LEGAL_STATE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
