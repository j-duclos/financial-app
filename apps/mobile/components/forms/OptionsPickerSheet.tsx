import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";

export type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
  searchText?: string;
};

type Props = {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  searchPlaceholder?: string;
  emptyMessage?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function OptionsPickerSheet({
  visible,
  title,
  options,
  selectedId,
  searchPlaceholder = "Search",
  emptyMessage = "No matches",
  onClose,
  onSelect,
}: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const hay = (opt.searchText ?? `${opt.title} ${opt.subtitle ?? ""}`).toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={() => {
        setQuery("");
        onClose();
      }}
    >
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={searchPlaceholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: theme.colors.text,
          marginBottom: 12,
          backgroundColor: theme.colors.surfaceMuted,
        }}
      />
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, paddingVertical: 16 }}>{emptyMessage}</Text>
        ) : (
          <View style={{ gap: 4 }}>
            {filtered.map((opt) => {
              const selected = opt.id === selectedId;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    onSelect(opt.id);
                    setQuery("");
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.sm,
                    borderRadius: theme.radius.md,
                    backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.tint : theme.colors.border,
                  }}
                >
                  <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>
                    {opt.title}
                  </Text>
                  {opt.subtitle ? (
                    <Text
                      style={{
                        color: theme.colors.textMuted,
                        ...theme.typography.caption,
                        marginTop: 2,
                      }}
                    >
                      {opt.subtitle}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
