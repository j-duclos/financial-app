import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Account } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { Button, Card, TextField } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  extraMonthly: string;
  lumpSum: string;
  lumpSumAccountId: number | null;
  creditCards: Account[];
  onApply: (next: {
    extraMonthly: string;
    lumpSum: string;
    lumpSumAccountId: number | null;
  }) => void;
  appliedExtraMonthly: string;
  appliedLumpSum: string;
  appliedLumpSumAccountId: number | null;
};

export function WhatIfPanel({
  extraMonthly,
  lumpSum,
  lumpSumAccountId,
  creditCards,
  onApply,
  appliedExtraMonthly,
  appliedLumpSum,
  appliedLumpSumAccountId,
}: Props) {
  const theme = useTheme();
  const [draftExtra, setDraftExtra] = useState(extraMonthly);
  const [draftLump, setDraftLump] = useState(lumpSum);
  const [draftLumpAccountId, setDraftLumpAccountId] = useState<number | null>(lumpSumAccountId);

  useEffect(() => {
    setDraftExtra(extraMonthly);
  }, [extraMonthly]);
  useEffect(() => {
    setDraftLump(lumpSum);
  }, [lumpSum]);
  useEffect(() => {
    setDraftLumpAccountId(lumpSumAccountId);
  }, [lumpSumAccountId]);

  const dirty =
    draftExtra !== appliedExtraMonthly ||
    draftLump !== appliedLumpSum ||
    draftLumpAccountId !== appliedLumpSumAccountId;

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 12 }}>
        Adjust plan
      </Text>
      <TextField
        label="Extra monthly"
        value={draftExtra}
        onChangeText={setDraftExtra}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityHint="Additional amount applied monthly toward debt payoff"
      />
      <TextField
        label="One-time lump sum"
        value={draftLump}
        onChangeText={setDraftLump}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityHint="Single extra payment applied once at plan start"
      />
      {draftLump.trim() !== "" && Number(draftLump) > 0 ? (
        <View style={{ marginBottom: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: 6 }}>
            Apply lump sum to card
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {creditCards.map((card) => {
              const selected = draftLumpAccountId === card.id;
              return (
                <Pressable
                  key={card.id}
                  onPress={() => setDraftLumpAccountId(selected ? null : card.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.tint : theme.colors.border,
                    backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surface,
                    minHeight: theme.touchTarget,
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: selected ? theme.colors.tint : theme.colors.text,
                      fontWeight: "600",
                      fontSize: 12,
                    }}
                  >
                    {getEffectiveDisplayName(card)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <Button
        label="Update plan"
        onPress={() =>
          onApply({
            extraMonthly: draftExtra,
            lumpSum: draftLump,
            lumpSumAccountId: draftLumpAccountId,
          })
        }
        disabled={!dirty}
      />
    </Card>
  );
}
