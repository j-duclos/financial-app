import React, { useMemo, useState } from "react";
import { Dimensions, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { isNoneCategoryPickerLabel } from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";

export type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
  searchText?: string;
  locked?: boolean;
  badge?: string;
  /** Stay at the top of the list (and of search matches). */
  pinned?: boolean;
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
  onSelectLocked?: (id: string) => void;
  /** Near-full-height sheet for long lists (categories). */
  tall?: boolean;
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
  onSelectLocked,
  tall = false,
}: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");

  const dismiss = () => {
    setQuery("");
    onClose();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = !q
      ? options
      : options.filter((opt) => {
          const hay = (opt.searchText ?? `${opt.title} ${opt.subtitle ?? ""}`).toLowerCase();
          return hay.includes(q);
        });
    const pinned = matches.filter((opt) => opt.pinned);
    const rest = matches.filter((opt) => !opt.pinned);
    const sortedRest = !q
      ? rest
      : [...rest].sort((a, b) => {
          const noneA = isNoneCategoryPickerLabel(a.title);
          const noneB = isNoneCategoryPickerLabel(b.title);
          if (noneA !== noneB) return noneA ? 1 : -1;
          return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
        });
    return [...pinned, ...sortedRest];
  }, [options, query]);

  const listMaxHeight = tall
    ? Math.round(Dimensions.get("window").height * 0.62)
    : 420;

  return (
    <BottomSheet
      visible={visible}
      onClose={dismiss}
      keyboardAware
      contentStyle={tall ? { maxHeight: "92%" } : undefined}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <Text
          style={{ color: theme.colors.text, ...theme.typography.headline, flex: 1 }}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
          style={{
            minWidth: theme.touchTarget,
            minHeight: theme.touchTarget,
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={searchPlaceholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={searchPlaceholder}
        accessibilityRole="search"
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: theme.colors.text,
          marginBottom: 12,
          backgroundColor: theme.colors.surfaceMuted,
          fontSize: 16,
        }}
      />
      <ScrollView
        style={{ maxHeight: listMaxHeight }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {filtered.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, paddingVertical: 16 }}>{emptyMessage}</Text>
        ) : (
          <View style={{ gap: 4 }}>
            {filtered.map((opt) => {
              const selected = opt.id === selectedId;
              return (
                <Pressable
                  key={opt.id || "any-category"}
                  onPress={() => {
                    if (opt.locked) {
                      onSelectLocked?.(opt.id);
                      return;
                    }
                    onSelect(opt.id);
                    setQuery("");
                    onClose();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={opt.title}
                  accessibilityState={{ selected, disabled: !!opt.locked, checked: selected }}
                  style={{
                    minHeight: theme.touchTarget,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.sm,
                    borderRadius: theme.radius.md,
                    backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.tint : theme.colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1 }}>
                        {opt.title}
                      </Text>
                      {opt.locked || opt.badge ? (
                        <Text style={{ color: theme.colors.textMuted, fontWeight: "700" }}>
                          {opt.badge ?? "Premium"}
                        </Text>
                      ) : null}
                    </View>
                    {opt.subtitle ? (
                      <Text
                        style={{
                          color: theme.colors.textMuted,
                          ...theme.typography.caption,
                        }}
                      >
                        {opt.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <FontAwesome
                      name="check"
                      size={16}
                      color={theme.colors.tint}
                      accessibilityLabel="Selected"
                    />
                  ) : (
                    <View style={{ width: 16 }} accessibilityElementsHidden />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
