import type { TimelineCalendarTransaction, TimelineDayDriver } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";
import { parseAmount } from "./timelineCalendarUtils";

export function formatShortDate(iso: string): string {
  return formatDateDisplay(iso);
}

/** Client-side fallback when API omits biggest_drivers. */
export function computeBiggestDriversFromTransactions(
  transactions: TimelineCalendarTransaction[],
  limit = 5
): TimelineDayDriver[] {
  const scored: { abs: number; driver: TimelineDayDriver }[] = [];
  for (const txn of transactions) {
    if (txn.is_transfer && parseAmount(txn.amount) > 0) continue;
    const amt = parseAmount(txn.amount);
    if (amt === 0) continue;
    scored.push({
      abs: Math.abs(amt),
      driver: {
        description: txn.description || "—",
        amount: amt.toFixed(2),
        kind: txn.kind,
        is_transfer: txn.is_transfer,
        account_name: txn.account_name,
      },
    });
  }
  scored.sort((a, b) => b.abs - a.abs || a.driver.description.localeCompare(b.driver.description));
  return scored.slice(0, limit).map((s) => s.driver);
}

export function resolveDayDrivers(
  drivers: TimelineDayDriver[] | undefined,
  transactions: TimelineCalendarTransaction[]
): TimelineDayDriver[] {
  if (drivers && drivers.length > 0) return drivers;
  return computeBiggestDriversFromTransactions(transactions);
}

export function formatDriverLine(driver: TimelineDayDriver): string {
  const amt = parseAmount(driver.amount);
  const signed = amt >= 0 ? "+" : "";
  return `${driver.description}: ${signed}${formatCurrency(driver.amount)}`;
}

export function formatDriverCompact(driver: TimelineDayDriver): string {
  const amt = parseAmount(driver.amount);
  const abs = Math.abs(amt);
  const prefix = amt >= 0 ? "+" : "-";
  return `${driver.description}: ${prefix}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
