import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ScenarioTemplateKey } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { SCENARIO_TEMPLATES, templateByKey } from "../scenarioTemplates";
import { ChipRow } from "../components/ChipRow";

type Props = {
  visible: boolean;
  households: Array<{ id: number; name: string }>;
  defaultHouseholdId: number | undefined;
  initialTemplate?: ScenarioTemplateKey;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (data: {
    household: number;
    name: string;
    description: string;
    template: ScenarioTemplateKey;
    horizon_months: number;
  }) => void;
};

export function CreateScenarioSheet({
  visible,
  households,
  defaultHouseholdId,
  initialTemplate = "blank",
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const theme = useTheme();
  const t = templateByKey(initialTemplate);
  const [template, setTemplate] = useState<ScenarioTemplateKey>(initialTemplate);
  const [householdId, setHouseholdId] = useState(String(defaultHouseholdId ?? households[0]?.id ?? ""));
  const [name, setName] = useState(initialTemplate === "blank" ? "" : t.label);
  const [description, setDescription] = useState(t.description);
  const [horizonMonths, setHorizonMonths] = useState("12");
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (key: ScenarioTemplateKey) => {
    const def = templateByKey(key);
    setTemplate(key);
    if (!name.trim() || SCENARIO_TEMPLATES.some((x) => x.label === name)) {
      setName(key === "blank" ? "" : def.label);
    }
    setDescription(def.description);
  };

  const handleSubmit = () => {
    const h = Number(householdId);
    if (!h || !name.trim()) {
      setError("Enter a plan name.");
      return;
    }
    setError(null);
    onSubmit({
      household: h,
      name: name.trim(),
      description: description.trim(),
      template,
      horizon_months: Number(horizonMonths) || 12,
    });
  };

  return (
    <BottomSheet visible={visible} title="New what-if plan" onClose={onClose}>
      <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: theme.spacing.md }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          Hypothetical only — your real accounts and transactions stay unchanged.
        </Text>
        <ChipRow
          label="Household"
          options={households.map((h) => ({ value: String(h.id), label: h.name }))}
          selected={householdId}
          onSelect={setHouseholdId}
        />
        <ChipRow
          label="Template"
          options={SCENARIO_TEMPLATES.map((x) => ({ value: x.key, label: x.label }))}
          selected={template}
          onSelect={(v) => applyTemplate(v as ScenarioTemplateKey)}
        />
        <TextField label="Name" value={name} onChangeText={setName} placeholder={t.label} />
        <TextField label="Description" value={description} onChangeText={setDescription} multiline />
        <ChipRow
          label="Forecast period"
          options={[
            { value: "3", label: "3 months" },
            { value: "6", label: "6 months" },
            { value: "12", label: "12 months" },
            { value: "24", label: "24 months" },
          ]}
          selected={horizonMonths}
          onSelect={setHorizonMonths}
        />
        <Button label="Create plan" onPress={handleSubmit} loading={submitting} />
      </ScrollView>
    </BottomSheet>
  );
}
