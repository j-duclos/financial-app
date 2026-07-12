import { describe, expect, it } from "vitest";
import type { DashboardAttentionItem } from "@budget-app/shared";
import {
  ATTENTION_MAX_CARDS,
  ATTENTION_VIEW_ALL_PATH,
  attentionAccountTypeLabel,
  attentionActionDuplicatesReason,
  attentionActionLine,
  attentionCardsForDisplay,
  attentionEmptyMessage,
  attentionFilterActionable,
  attentionIsActionable,
  attentionIssueIcon,
  attentionKeyAmountLabel,
  attentionLedgerState,
  attentionPaymentPlannerPath,
  attentionSecondaryIsPaymentPlanner,
  attentionSecondaryPath,
  attentionShowsDedicatedPaymentPlanner,
  attentionPrimaryIssue,
  attentionShowsActionLine,
  attentionShowsKeyAmount,
  attentionShowsPaymentPlanner,
  attentionShowsRiskDate,
  attentionShowsTargetUtilization,
  attentionPrimaryLabel,
  attentionRiskDateLabel,
  attentionSecondaryLabel,
  attentionSecondaryOpensTransferModal,
  attentionSeverityStyles,
  attentionShowsSecondaryAction,
  attentionShowsViewAllLink,
  attentionTargetUtilizationLabel,
  attentionTransferPreset,
} from "./attentionCardDisplay";
import { AlertTriangle, ArrowLeftRight, CreditCard } from "lucide-react";

function sampleItem(
  overrides: Partial<DashboardAttentionItem> = {}
): DashboardAttentionItem {
  return {
    account_id: 1,
    account_name: "Main",
    account_role: "spending",
    account_type: "CHECKING",
    status: "critical",
    reason: "Projected negative Jun 17",
    recommended_action: "Move $37.06 before Jun 17.",
    amount: "37.06",
    risk_date: "2025-06-17",
    url: "/accounts?account=1",
    primary_action: { label: "Open ledger", type: "open_ledger", url: "/transactions" },
    secondary_action: { label: "Move money", type: "move_money", url: "/accounts?account=1" },
    ...overrides,
  };
}

describe("attentionCardDisplay", () => {
  it("shows empty state when nothing actionable", () => {
    expect(attentionEmptyMessage(30)).toMatch(/nothing needs your attention/i);
  });

  it("limits view-all link to accounts health filter", () => {
    expect(ATTENTION_VIEW_ALL_PATH).toBe("/accounts?attention=1");
  });

  it("passes ledger navigation state for account", () => {
    expect(attentionLedgerState(42)).toEqual({ accountId: 42 });
  });

  it("filters out healthy and low-signal watch items", () => {
    const items = [
      sampleItem({ account_id: 1, status: "healthy" }),
      sampleItem({
        account_id: 2,
        status: "watch",
        recommended_action: "Review upcoming activity.",
        amount: null,
      }),
      sampleItem({ account_id: 3, status: "critical" }),
    ];
    expect(attentionFilterActionable(items)).toHaveLength(1);
    expect(attentionFilterActionable(items)[0].account_id).toBe(3);
    expect(attentionIsActionable(sampleItem({ status: "healthy" }))).toBe(false);
  });

  it("applies severity-specific card styling", () => {
    expect(attentionSeverityStyles("critical").card).toMatch(/red/i);
    expect(attentionSeverityStyles("watch").card).toMatch(/yellow/i);
    expect(attentionSeverityStyles("risk").card).toMatch(/amber/i);
  });

  it("renders recommended action labels from item", () => {
    const cash = sampleItem();
    expect(cash.recommended_action).toContain("Move $37.06");
    expect(attentionPrimaryLabel(cash)).toBe("Open ledger");
    expect(attentionSecondaryLabel(cash)).toBe("Fix Shortfall");
    expect(attentionShowsSecondaryAction(cash)).toBe(true);
    expect(attentionSecondaryOpensTransferModal(cash)).toBe(true);
    expect(attentionTransferPreset(cash)).toEqual(
      expect.objectContaining({
        accountId: 1,
        mode: "transfer",
        transferToAccountId: 1,
        defaultAmount: "37.06",
        fixShortfall: true,
      })
    );
  });

  it("credit card shows payment planner paths", () => {
    const credit = sampleItem({
      account_role: "credit_card",
      account_type: "CREDIT",
      reason: "Utilization is 98%",
      recommended_action: "Pay $850.00 toward utilization target.",
      secondary_action: {
        label: "Make payment", // normalized in UI
        type: "make_payment",
        url: "/accounts?account=1",
      },
    });
    expect(attentionSecondaryLabel(credit)).toBe("Payment Planner");
    expect(attentionSecondaryOpensTransferModal(credit)).toBe(false);
    expect(attentionShowsPaymentPlanner(credit)).toBe(true);
    expect(attentionSecondaryIsPaymentPlanner(credit)).toBe(true);
    expect(attentionShowsDedicatedPaymentPlanner(credit)).toBe(false);
    expect(attentionSecondaryPath(credit)).toBe("/credit-cards?account=1");
    expect(attentionPaymentPlannerPath(1)).toBe("/credit-cards?account=1");
  });

  it("shows utilization target for credit cards", () => {
    const credit = sampleItem({
      account_role: "credit_card",
      account_type: "CREDIT",
      reason: "Utilization is 98%",
      target_utilization_percent: "10",
    });
    expect(attentionTargetUtilizationLabel(credit)).toBe("Target: 10%");
  });

  it("picks contextual issue icons", () => {
    expect(attentionIssueIcon(sampleItem())).toBe(ArrowLeftRight);
    expect(
      attentionIssueIcon(
        sampleItem({
          account_type: "CREDIT",
          reason: "Utilization is 98%",
          recommended_action: "Pay $100 toward utilization target.",
          secondary_action: {
            label: "Make payment", // normalized in UI
            type: "make_payment",
            url: "/accounts?account=1",
          },
        })
      )
    ).toBe(CreditCard);
    expect(
      attentionIssueIcon(
        sampleItem({
          reason: "Below safety buffer",
          recommended_action: null,
          secondary_action: null,
        })
      )
    ).toBe(AlertTriangle);
  });

  it("shows account type label in header helpers", () => {
    expect(attentionAccountTypeLabel(sampleItem())).toBe("Checking");
  });

  it("savings may omit secondary action", () => {
    const savings = sampleItem({
      account_role: "savings",
      account_type: "SAVINGS",
      status: "watch",
      secondary_action: null,
      recommended_action: "Add $50.00 to restore buffer.",
      amount: "50",
    });
    expect(attentionShowsSecondaryAction(savings)).toBe(false);
    expect(attentionIsActionable(savings)).toBe(true);
  });

  it("limits displayed attention cards to max 3 after filtering", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      sampleItem({ account_id: i + 1, account_name: `Acct ${i + 1}` })
    );
    expect(attentionCardsForDisplay(items)).toHaveLength(ATTENTION_MAX_CARDS);
    expect(attentionCardsForDisplay(items)[0].account_id).toBe(1);
  });

  it("shows view-all link when more issues exist than displayed", () => {
    expect(attentionShowsViewAllLink(3, 5)).toBe(true);
    expect(attentionShowsViewAllLink(3, 3)).toBe(false);
    expect(attentionShowsViewAllLink(0, 0)).toBe(false);
  });

  it("formats key amount and risk date for cards", () => {
    const item = sampleItem({ amount: "37.06", risk_date: "2025-06-17" });
    expect(attentionKeyAmountLabel(item)).toMatch(/\$37\.06/);
    expect(attentionRiskDateLabel(item)).toBe("06-17-25");
  });

  it("uses concise primary issue and action line without duplication", () => {
    const item = sampleItem();
    expect(attentionPrimaryIssue(item)).toBe("Projected negative Jun 17");
    expect(attentionActionLine(item)).toBe("Move $37.06 before Jun 17.");
    expect(attentionShowsActionLine(item)).toBe(true);
    expect(attentionShowsKeyAmount(item)).toBe(false);
    expect(attentionShowsRiskDate(item)).toBe(false);
    expect(attentionActionDuplicatesReason(item)).toBe(false);
  });

  it("hides action line when it repeats the primary issue", () => {
    const item = sampleItem({
      reason: "Utilization is 98%",
      recommended_action: "Utilization is 98%",
    });
    expect(attentionActionDuplicatesReason(item)).toBe(true);
    expect(attentionShowsActionLine(item)).toBe(false);
  });

  it("hides utilization target when reason already states utilization", () => {
    const credit = sampleItem({
      reason: "Utilization is 98%",
      target_utilization_percent: "10",
    });
    expect(attentionShowsTargetUtilization(credit)).toBe(false);
  });
});
