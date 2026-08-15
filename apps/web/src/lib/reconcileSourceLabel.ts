export function reconcileSourceTooltip(
  source: string | null | undefined,
  institution?: string | null
): string {
  const src = String(source ?? "").toUpperCase();
  if (src === "PLAID") {
    const inst = (institution ?? "").trim();
    return inst ? `Imported from ${inst} via Plaid` : "Imported transaction";
  }
  if (src === "RULE" || src === "ONE_TIME") return "Scheduled automation";
  if (src === "INTEREST") return "Interest charge";
  if (src === "SYSTEM") return "System transaction";
  return "Manual transaction";
}
