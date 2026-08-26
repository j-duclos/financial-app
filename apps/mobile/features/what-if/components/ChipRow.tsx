import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";

type Option = { value: string; label: string };

type Props = {
  label: string;
  options: Option[];
  selected: string;
  onSelect: (value: string) => void;
};

export function ChipRow({ label, options, selected, onSelect }: Props) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <Pressable
              key={opt.value || "__empty"}
              onPress={() => onSelect(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${label}: ${opt.label}`}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.tint : theme.colors.border,
                backgroundColor: isSelected ? theme.colors.tintMuted : theme.colors.surface,
                minHeight: theme.touchTarget,
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: isSelected ? theme.colors.tint : theme.colors.text,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
