import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ScenarioTemplateKey } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { OptionsPickerSheet } from "@/features/recurring/OptionsPickerSheet";
import { ChipRow } from "../components/ChipRow";
import { SelectRow } from "../components/SelectRow";
import { SCENARIO_TEMPLATES, templateByKey } from "../scenarioTemplates";

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

function defaultNameForTemplate(key: ScenarioTemplateKey): string {
  if (key === "blank" || key === "custom") return "";
  return `${templateByKey(key).label} scenario`;
}

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
  const [name, setName] = useState(defaultNameForTemplate(initialTemplate));
  const [description, setDescription] = useState(t.description);
  const [horizonMonths, setHorizonMonths] = useState("12");
  const [error, setError] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [householdPickerOpen, setHouseholdPickerOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTemplate(initialTemplate);
    setName(defaultNameForTemplate(initialTemplate));
    setDescription(templateByKey(initialTemplate).description);
    setHouseholdId(String(defaultHouseholdId ?? households[0]?.id ?? ""));
    setHorizonMonths("12");
    setError(null);
  }, [visible, initialTemplate, defaultHouseholdId, households]);

  const applyTemplate = (key: ScenarioTemplateKey) => {
    const def = templateByKey(key);
    setTemplate(key);
    const autoNames = SCENARIO_TEMPLATES.map((x) => defaultNameForTemplate(x.key)).filter(Boolean);
    if (!name.trim() || autoNames.includes(name) || SCENARIO_TEMPLATES.some((x) => x.label === name)) {
      setName(defaultNameForTemplate(key));
    }
    setDescription(def.description);
  };

  const handleSubmit = () => {
    const h = Number(householdId);
    const resolvedName = name.trim() || defaultNameForTemplate(template) || "What-If plan";
    if (!h) {
      setError("Select a household.");
      return;
    }
    setError(null);
    onSubmit({
      household: h,
      name: resolvedName,
      description: description.trim(),
      template,
      horizon_months: Number(horizonMonths) || 12,
    });
  };

  const showHouseholdPicker = households.length > 1;
  const selectedHousehold = households.find((h) => String(h.id) === householdId);
  const selectedTemplate = templateByKey(template);

  return (
    <>
      <BottomSheet visible={visible} title="New what-if plan" onClose={onClose}>
        <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: theme.spacing.md }}>
          {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            Hypothetical only — your real accounts and transactions stay unchanged.
          </Text>

          {showHouseholdPicker ? (
            <SelectRow
              label="Household"
              value={selectedHousehold?.name ?? null}
              placeholder="Select household"
              onPress={() => setHouseholdPickerOpen(true)}
            />
          ) : null}

          <SelectRow
            label="Template"
            value={selectedTemplate.label}
            onPress={() => setTemplatePickerOpen(true)}
          />

          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={defaultNameForTemplate(template) || "What-If plan"}
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <View>
            <ChipRow
              label="Forecast period"
              options={[
                { value: "3", label: "3 mo" },
                { value: "6", label: "6 mo" },
                { value: "12", label: "12 mo" },
                { value: "24", label: "24 mo" },
              ]}
              selected={horizonMonths}
              onSelect={setHorizonMonths}
            />
          </View>

          <Button label="Create plan" onPress={handleSubmit} loading={submitting} />
        </ScrollView>
      </BottomSheet>

      <OptionsPickerSheet
        visible={templatePickerOpen}
        title="Template"
        options={SCENARIO_TEMPLATES.map((x) => ({
          id: x.key,
          title: x.label,
          subtitle: x.description,
          searchText: `${x.label} ${x.description}`,
        }))}
        selectedId={template}
        searchPlaceholder="Search templates"
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={(id) => {
          applyTemplate(id as ScenarioTemplateKey);
          setTemplatePickerOpen(false);
        }}
      />

      <OptionsPickerSheet
        visible={householdPickerOpen}
        title="Household"
        options={households.map((h) => ({ id: String(h.id), title: h.name }))}
        selectedId={householdId || null}
        onClose={() => setHouseholdPickerOpen(false)}
        onSelect={(id) => {
          setHouseholdId(id);
          setHouseholdPickerOpen(false);
        }}
      />
    </>
  );
}
