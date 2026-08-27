import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Scenario } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  visible: boolean;
  scenarios: Scenario[];
  selectedId: number | null;
  onClose: () => void;
  onSelect: (id: number) => void;
};

export function PlanPickerSheet({ visible, scenarios, selectedId, onClose, onSelect }: Props) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} title="Choose plan" onClose={onClose}>
      <ScrollView style={{ maxHeight: 420 }}>
        {scenarios.map((s) => {
          const selected = s.id === selectedId;
          return (
            <Pressable
              key={s.id}
              onPress={() => {
                onSelect(s.id);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: 16,
                    fontWeight: selected ? "700" : "500",
                  }}
                >
                  {s.name}
                </Text>
                {s.description ? (
                  <Text style={{ color: theme.colors.textMuted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
                    {s.description}
                  </Text>
                ) : null}
              </View>
              {selected ? <Text style={{ color: theme.colors.tint, fontWeight: "700" }}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}
