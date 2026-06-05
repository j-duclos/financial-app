import type { DashboardUpcomingItem } from "@budget-app/shared";

export function upcomingKindLabel(kind: DashboardUpcomingItem["kind"]): string {
  switch (kind) {
    case "income":
      return "Income";
    case "bill":
      return "Bill";
    case "transfer":
      return "Transfer";
    case "credit_card":
      return "Credit card";
    case "risk":
      return "Risk";
    default:
      return kind;
  }
}

export function upcomingKindBadgeClass(kind: DashboardUpcomingItem["kind"]): string {
  switch (kind) {
    case "income":
      return "bg-green-100 text-green-800";
    case "bill":
      return "bg-gray-100 text-gray-700";
    case "transfer":
      return "bg-blue-100 text-blue-800";
    case "credit_card":
      return "bg-purple-100 text-purple-800";
    case "risk":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function attentionItemsLimited<T>(items: T[], limit = 3): T[] {
  return items.slice(0, limit);
}

export function dashboardUsesTableForAttention(attentionCount: number): boolean {
  return attentionCount > 0 && false;
}
