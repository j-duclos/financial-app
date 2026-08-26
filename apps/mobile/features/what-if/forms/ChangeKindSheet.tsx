import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import type { ExpenseChangeKind, IncomeChangeKind } from "../types";

type KindOption<K extends string> = { kind: K; title: string; hint: string };

const INCOME_OPTIONS: KindOption<IncomeChangeKind>[] = [
  { kind: "one_time", title: "One-time income", hint: "Tax refund, bonus, gift" },
  { kind: "paycheck", title: "Future paycheck change", hint: "Raise, new job, reduced hours" },
  { kind: "new_recurring", title: "New recurring income", hint: "Rental, side business, pension" },
];

const EXPENSE_OPTIONS: KindOption<ExpenseChangeKind>[] = [
  { kind: "one_time", title: "One-time expense", hint: "Repair, medical bill, purchase" },
  { kind: "current", title: "Change current bill", hint: "Increase, decrease, or cancel" },
  { kind: "new_recurring", title: "New recurring expense", hint: "Subscription, new bill" },
];

type Props =
  | {
      visible: boolean;
      mode: "income";
      onClose: () => void;
      onSelect: (kind: IncomeChangeKind) => void;
    }
  | {
      visible: boolean;
      mode: "expense";
      onClose: () => void;
      onSelect: (kind: ExpenseChangeKind) => void;
    };

export function ChangeKindSheet(props: Props) {
  const theme = useTheme();
  const options = props.mode === "income" ? INCOME_OPTIONS : EXPENSE_OPTIONS;
  const title = props.mode === "income" ? "What kind of income change?" : "What kind of expense change?";

  return (
    <BottomSheet visible={props.visible} title={title} onClose={props.onClose}>
      <ScrollView contentContainerStyle={{ gap: theme.spacing.sm }}>
        {options.map((opt) => (
          <Pressable
            key={opt.kind}
            onPress={() => {
              if (props.mode === "income") {
                (props as Extract<Props, { mode: "income" }>).onSelect(opt.kind as IncomeChangeKind);
              } else {
                (props as Extract<Props, { mode: "expense" }>).onSelect(opt.kind as ExpenseChangeKind);
              }
              props.onClose();
            }}
            accessibilityRole="button"
            style={{
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{opt.title}</Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
              {opt.hint}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

export function AddChangeMenuSheet({
  visible,
  onClose,
  onAddIncome,
  onAddExpense,
  onTransfer,
  onPayDownDebt,
  onRecurringDebt,
}: {
  visible: boolean;
  onClose: () => void;
  onAddIncome: () => void;
  onAddExpense: () => void;
  onTransfer: () => void;
  onPayDownDebt: () => void;
  onRecurringDebt: () => void;
}) {
  const theme = useTheme();
  const actions = [
    { label: "Add income change", onPress: onAddIncome },
    { label: "Add expense change", onPress: onAddExpense },
    { label: "Transfer money", onPress: onTransfer },
    { label: "Pay down debt", onPress: onPayDownDebt },
    { label: "Add recurring debt payment", onPress: onRecurringDebt },
  ];

  return (
    <BottomSheet visible={visible} title="Add to this plan" onClose={onClose}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => {
            a.onPress();
            onClose();
          }}
          accessibilityRole="button"
          style={{
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "500" }}>{a.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}
