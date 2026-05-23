import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { listAccountRelationships, listPlaidItems } from "@budget-app/api-client";
import {
  accountRoleForQuickActions,
  type QuickActionDef,
  type QuickActionsContext,
} from "../lib/accountQuickActions";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";
import type { QuickRecurringPreset } from "../components/quickActions/QuickRecurringModal";
import type { ForecastDays } from "../lib/safeToSpendLabels";

export function useAccountsQuickActions(
  accounts: Account[],
  householdId: number | undefined,
  forecastDays: ForecastDays,
  onEditAccount: (account: Account) => void
) {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  const [txnPreset, setTxnPreset] = useState<QuickTransactionPreset | null>(null);
  const [recurringPreset, setRecurringPreset] = useState<QuickRecurringPreset | null>(null);
  const [forecastAccount, setForecastAccount] = useState<Account | null>(null);

  const { data: plaidItemsData } = useQuery({
    queryKey: ["plaid-items", householdId],
    queryFn: () =>
      listPlaidItems(householdId != null ? { household: householdId, page_size: 100 } : { page_size: 100 }),
  });

  const { data: relationships } = useQuery({
    queryKey: ["account-relationships", householdId],
    queryFn: () =>
      listAccountRelationships({
        household: householdId,
        is_active: true,
      }),
    enabled: householdId != null,
  });

  const plaidLinkedAccountIds = useMemo(() => {
    const ids = new Set<number>();
    for (const item of plaidItemsData?.results ?? []) {
      for (const la of item.linked_accounts ?? []) {
        ids.add(la.account_id);
      }
    }
    return ids;
  }, [plaidItemsData]);

  const quickActionsContext: QuickActionsContext = useMemo(
    () => ({
      plaidLinkedAccountIds,
      allAccounts: accounts,
      relationships: relationships ?? [],
      forecastDays,
    }),
    [plaidLinkedAccountIds, accounts, relationships, forecastDays]
  );

  const openTransaction = useCallback((preset: QuickTransactionPreset) => {
    setTxnPreset(preset);
  }, []);

  const openRecurring = useCallback((preset: QuickRecurringPreset) => {
    setRecurringPreset(preset);
  }, []);

  const handleQuickAction = useCallback(
    (account: Account, action: QuickActionDef) => {
      const hid =
        typeof account.household === "object"
          ? account.household?.id
          : (account.household as number | undefined);
      const payload = action.payload;

      switch (action.id) {
        case "add_transaction":
        case "add_expense":
          openTransaction({ accountId: account.id, mode: "expense" });
          return;
        case "add_income":
          openTransaction({ accountId: account.id, mode: "income" });
          return;
        case "add_purchase":
          openTransaction({ accountId: account.id, mode: "purchase" });
          return;
        case "add_contribution":
          openTransaction({ accountId: account.id, mode: "contribution" });
          return;
        case "transfer":
        case "transfer_funds": {
          const from = payload?.transferFromAccountId ?? account.id;
          openTransaction({
            accountId: from,
            mode: "transfer",
            transferFromAccountId: from,
            transferToAccountId: payload?.transferToAccountId,
          });
          return;
        }
        case "relationship_transfer":
        case "move_to_savings": {
          const from = payload?.transferFromAccountId ?? account.id;
          const to = payload?.transferToAccountId;
          openTransaction({
            accountId: from,
            mode: "transfer",
            transferFromAccountId: from,
            transferToAccountId: to,
            defaultAmount: payload?.amount,
          });
          return;
        }
        case "pay_card":
        case "pay_statement":
        case "pay_minimum":
        case "pay_current": {
          const cardId = payload?.transferToAccountId ?? account.id;
          const from =
            payload?.transferFromAccountId ??
            account.autopay_account ??
            (account.account_type === "CREDIT" ? undefined : account.id);
          const sourceId = from ?? account.id;
          openTransaction({
            accountId: sourceId,
            mode: "credit_card_payment",
            transferFromAccountId: sourceId,
            transferToAccountId: cardId,
            defaultAmount: payload?.amount,
          });
          return;
        }
        case "schedule":
          openRecurring({
            accountId: account.id,
            householdId: hid!,
            direction: "EXPENSE",
            defaultAmount: payload?.amount,
          });
          return;
        case "schedule_savings":
        case "schedule_payment":
        case "schedule_contribution":
          openRecurring({
            accountId: account.id,
            householdId: hid!,
            direction: payload?.recurringDirection ?? "TRANSFER",
            transferToAccountId: payload?.transferToAccountId,
            defaultAmount: payload?.amount,
          });
          return;
        case "view_forecast":
        case "view_statement":
        case "view_utilization":
          setForecastAccount(account);
          return;
        case "view_transactions":
        case "view_upcoming":
          navigate("/transactions", { state: { accountId: account.id, focus: action.id } });
          return;
        case "reconcile":
          navigate("/reconcile", { state: { accountId: account.id } });
          return;
        case "import_txns":
          navigate("/transactions", { state: { accountId: account.id, focusPlaid: true } });
          return;
        case "link_payment":
          onEditAccount(account);
          return;
        case "move_before_risk":
          openTransaction({
            accountId: account.id,
            mode: "transfer",
            defaultPayee: action.label,
          });
          return;
        default:
          return;
      }
    },
    [navigate, onEditAccount, openRecurring, openTransaction]
  );

  return {
    quickActionsContext,
    toast,
    setToast,
    txnPreset,
    setTxnPreset,
    recurringPreset,
    setRecurringPreset,
    forecastAccount,
    setForecastAccount,
    handleQuickAction,
    accountRoleForQuickActions,
  };
}
