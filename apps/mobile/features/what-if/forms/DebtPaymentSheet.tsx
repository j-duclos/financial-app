import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, RecurringRule, ScenarioOneTimeEvent, ScenarioRuleOverride } from "@budget-app/shared";
import { formatAccountOptionLabel, formatCurrency } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { DatePickerField } from "@/features/recurring/DatePickerField";
import { OptionsPickerSheet, type PickerOption } from "@/features/recurring/OptionsPickerSheet";
import { SelectRow } from "../components/SelectRow";
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

type PickerKind = "source" | "debt" | "rule" | null;

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
  const [picker, setPicker] = useState<PickerKind>(null);

  const debtAccount = debtAccounts.find((a) => a.id === Number(debtId));
  const sourceAccount = assetAccounts.find((a) => a.id === Number(sourceId));
  const debtRules = useMemo(() => {
    if (!debtAccount) return [];
    return rules.filter((r) => r.active && rulePaysDebtAccount(r, debtAccount));
  }, [rules, debtAccount]);
  const selectedRule = debtRules.find((r) => String(r.id) === ruleId) ?? debtRules[0];

  const sourceOptions: PickerOption[] = useMemo(
    () =>
      assetAccounts.map((a) => ({
        id: String(a.id),
        title: formatAccountOptionLabel(a),
        searchText: formatAccountOptionLabel(a),
      })),
    [assetAccounts]
  );

  const debtOptions: PickerOption[] = useMemo(
    () =>
      debtAccounts.map((a) => ({
        id: String(a.id),
        title: formatAccountOptionLabel(a),
        subtitle: formatDebtBalance(a),
        searchText: `${formatAccountOptionLabel(a)} ${formatDebtBalance(a)}`,
      })),
    [debtAccounts]
  );

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
    <>
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
          <SelectRow
            label="Pay from"
            value={sourceAccount ? formatAccountOptionLabel(sourceAccount) : null}
            placeholder="Select account"
            onPress={() => setPicker("source")}
          />
          <SelectRow
            label="Debt account"
            value={
              debtAccount
                ? `${formatAccountOptionLabel(debtAccount)} · ${formatDebtBalance(debtAccount)}`
                : null
            }
            placeholder="Select debt"
            onPress={() => setPicker("debt")}
          />
          {paymentType === "monthly_increase" && debtRules.length > 0 ? (
            <SelectRow
              label="Recurring payment"
              value={
                selectedRule
                  ? `${selectedRule.name} (${formatCurrency(selectedRule.amount, selectedRule.currency)})`
                  : null
              }
              onPress={() => setPicker("rule")}
            />
          ) : null}
          <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          {paymentType === "one_time" ? (
            <DatePickerField label="Payment date" value={date} onChange={setDate} />
          ) : null}
          <Button label="Save change" onPress={handleSubmit} loading={saving} />
        </ScrollView>
      </BottomSheet>

      <OptionsPickerSheet
        visible={picker === "source"}
        title="Pay from"
        options={sourceOptions}
        selectedId={sourceId || null}
        searchPlaceholder="Search accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setSourceId(id);
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "debt"}
        title="Debt account"
        options={debtOptions}
        selectedId={debtId || null}
        searchPlaceholder="Search debts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setDebtId(id);
          setRuleId("");
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "rule"}
        title="Recurring payment"
        options={debtRules.map((r) => ({
          id: String(r.id),
          title: r.name,
          subtitle: formatCurrency(r.amount, r.currency),
        }))}
        selectedId={ruleId || String(debtRules[0]?.id ?? "")}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setRuleId(id);
          setPicker(null);
        }}
      />
    </>
  );
}
