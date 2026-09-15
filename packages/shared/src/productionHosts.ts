/** Live Render web service that serves Django API + built web UI. */
export const PRODUCTION_RENDER_HOST = "financial-app-5ywr.onrender.com";

export const PRODUCTION_RENDER_ORIGIN = `https://${PRODUCTION_RENDER_HOST}`;

/** Public hostname for the same service (custom domain). Prefer this on mobile. */
export const PRODUCTION_PUBLIC_ORIGIN = "https://flowsight360.com";

/** Retired Render service names that must not appear in release config. */
export const STALE_RENDER_HOSTS = ["financial-app-1-tu0l.onrender.com"] as const;

export function isProductionRenderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === PRODUCTION_RENDER_HOST ||
    normalized === "flowsight360.com" ||
    normalized === "www.flowsight360.com"
  );
}

export function isStaleRenderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return STALE_RENDER_HOSTS.some((stale) => normalized === stale || normalized.endsWith(`.${stale}`));
}
