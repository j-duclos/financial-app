import React from "react";
import { Pressable, Text, View } from "react-native";
import type { ScenarioTemplateKey } from "@budget-app/shared";
import { Button } from "@/components/ui";
import { useTheme } from "@/theme";
import { EMPTY_STATE_TEMPLATES } from "../scenarioTemplates";

type Props = {
  onPickTemplate: (key: ScenarioTemplateKey) => void;
  onCreateBlank: () => void;
};

export function WhatIfEmptyState({ onPickTemplate, onCreateBlank }: Props) {
  const theme = useTheme();

  return (
    <View style={{ paddingVertical: theme.spacing.xl }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, textAlign: "center" }}>
        Create a what-if plan
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.body,
          textAlign: "center",
          marginTop: 8,
          marginBottom: theme.spacing.lg,
        }}
      >
        See how changes to income, bills, or payments could affect your forecast — without touching your real
        financial data.
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        {EMPTY_STATE_TEMPLATES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => onPickTemplate(t.key)}
            accessibilityRole="button"
            style={{
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{t.label}</Text>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
              {t.description}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: theme.spacing.lg }}>
        <Button label="Start with a blank plan" variant="secondary" onPress={onCreateBlank} />
      </View>
    </View>
  );
}
