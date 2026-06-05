/** Human-first copy for Recurring page summary cards. */

export const RECURRING_SUMMARY = {
  activeRules: {
    label: "Active recurring rules",
    help: "Recurring rules that are on and still generating scheduled payments.",
  },
  monthlyObligations: {
    label: "Monthly recurring obligations",
    help: "Estimated monthly total from active rules, normalized by each rule's cadence.",
  },
  upcomingCharges: {
    label: "Upcoming charges (30d)",
    help: "Active rules with a scheduled charge in the next 30 days.",
  },
  missedPayments: {
    label: "Missed payments",
    help: "Recurring payments that were due but not matched to a transaction.",
  },
  dueSoon: {
    label: "Due soon (5d)",
    help: "Active rules with a payment due within the next 5 days.",
  },
} as const;
