/** Single Render web service that serves Django API + built web UI. */
export const PRODUCTION_RENDER_HOST = "financial-app-1-tu0l.onrender.com";

export const PRODUCTION_RENDER_ORIGIN = `https://${PRODUCTION_RENDER_HOST}`;

/** Retired Render service names that must not appear in release config. */
export const STALE_RENDER_HOSTS = ["financial-app-5ywr.onrender.com"] as const;

export function isProductionRenderHost(host: string): boolean {
  return host.trim().toLowerCase() === PRODUCTION_RENDER_HOST;
}

export function isStaleRenderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return STALE_RENDER_HOSTS.some((stale) => normalized === stale || normalized.endsWith(`.${stale}`));
}
