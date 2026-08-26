import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, RecurringRule, ScenarioOneTimeEvent, ScenarioRuleOverride } from "@budget-app/shared";
import { formatAccountOptionLabel, formatCurrency } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { ChipRow } from "../components/ChipRow";
import {
  DEBT_OVERRIDE_NOTE,
  debtEventNote,
  filterAssetAccounts,
  filterDebtAccounts,
  formatDebtBalance,
  rulePaysDebtAccount,
} from "../scenarioDebtPayment";
import {
  createScenarioOneTimeEvent,
  createScenarioOverride,
  updateScenarioOneTimeEvent,
  updateScenarioOverride,
} from "@budget-app/api-client";

type Props = {
  visible: boolean;
  scenarioId: number;
  accounts: Account[];
  rules: RecurringRule[];
  initialDebtAccountId?: number | null;
  existingEvent?: ScenarioOneTimeEvent | null;
  existingOverride?: ScenarioRuleOverride | null;
  onClose: () => void;
  onSaved: () => void;
};

export function DebtPaymentSheet({
  visible,
  scenarioId,
  accounts,
  rules,
  initialDebtAccountId,
  existingEvent,
  existingOverride,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const assetAccounts = useMemo(() => filterAssetAccounts(accounts), [accounts]);
  const debtAccounts = useMemo(() => filterDebtAccounts(accounts), [accounts]);

  const isEdit = !!existingEvent || !!existingOverride;

  const [paymentType, setPaymentType] = useState<"one_time" | "monthly_increase">(
    existingOverride ? "monthly_increase" : "one_time"
  );
  const [sourceId, setSourceId] = useState(
    String(existingEvent?.account?.id ?? existingOverride?.rule?.account?.id ?? assetAccounts[0]?.id ?? "")
  );
  const [debtId, setDebtId] = useState(
    String(
      existingEvent?.transfer_to_account?.id ??
        existingOverride?.rule?.transfer_to_account?.id ??
        initialDebtAccountId ??
        debtAccounts[0]?.id ??
        ""
    )
  );
  const [amount, setAmount] = useState(existingEvent?.amount ?? existingOverride?.override_amount ?? "");
  const [date, setDate] = useState(existingEvent?.date ?? todayStr());
  const [ruleId, setRuleId] = useState(String(existingOverride?.rule?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debtAccount = debtAccounts.find((a) => a.id === Number(debtId));
  const debtRules = useMemo(() => {
    if (!debtAccount) return [];
    return rules.filter((r) => r.active && rulePaysDebtAccount(r, debtAccount));
  }, [rules, debtAccount]);

  const handleSubmit = async () => {
    if (!sourceId || !debtId || !amount.trim()) {
      setError("Fill in source, debt account, and amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (paymentType === "monthly_increase") {
        const rid = ruleId || debtRules[0]?.id;
        if (!rid) {
          setError("No recurring payment found for this debt. Add a recurring debt payment instead.");
          setSaving(false);
          return;
        }
        const body = {
          rule_id: Number(rid),
          override_amount: String(Math.abs(parseFloat(amount))),
          override_active: true as const,
          override_start_date: null,
          override_end_date: null,
          override_account_id: Number(sourceId),
          override_category_id: null,
          notes: DEBT_OVERRIDE_NOTE,
        };
        if (existingOverride) {
          await updateScenarioOverride(existingOverride.id, body);
        } else {
          await createScenarioOverride(scenarioId, body);
        }
      } else {
        const debtName = debtAccount?.name ?? "debt";
        const body = {
          date,
          account_id: Number(sourceId),
          transfer_to_account_id: Number(debtId),
          description: `Debt payment to ${debtName}`,
          direction: "TRANSFER" as const,
          amount: String(Math.abs(parseFloat(amount))),
          category_id: null,
          notes: debtEventNote("one_time"),
        };
        if (existingEvent) {
          await updateScenarioOneTimeEvent(existingEvent.id, body);
        } else {
          await createScenarioOneTimeEvent(scenarioId, body);
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save debt change.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} title={isEdit ? "Edit debt change" : "Pay down debt"} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.spacing.md }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          Hypothetical debt payment — does not move real money.
        </Text>
        {!isEdit ? (
          <ChipRow
            label="Change type"
            options={[
              { value: "one_time", label: "One-time payment" },
              { value: "monthly_increase", label: "Increase monthly payment" },
            ]}
            selected={paymentType}
            onSelect={(v) => setPaymentType(v as "one_time" | "monthly_increase")}
          />
        ) : null}
        <ChipRow
          label="Pay from"
          options={assetAccounts.map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
          selected={sourceId}
          onSelect={setSourceId}
        />
        <ChipRow
          label="Debt account"
          options={debtAccounts.map((a) => ({
            value: String(a.id),
            label: `${formatAccountOptionLabel(a)} · ${formatDebtBalance(a)}`,
          }))}
          selected={debtId}
          onSelect={setDebtId}
        />
        {paymentType === "monthly_increase" && debtRules.length > 0 ? (
          <ChipRow
            label="Recurring payment rule"
            options={debtRules.map((r) => ({
              value: String(r.id),
              label: `${r.name} (${formatCurrency(r.amount, r.currency)})`,
            }))}
            selected={ruleId || String(debtRules[0]?.id ?? "")}
            onSelect={setRuleId}
          />
        ) : null}
        <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        {paymentType === "one_time" ? (
          <TextField label="Payment date" value={date} onChangeText={setDate} />
        ) : null}
        <Button label="Save change" onPress={handleSubmit} loading={saving} />
      </ScrollView>
    </BottomSheet>
  );
}
