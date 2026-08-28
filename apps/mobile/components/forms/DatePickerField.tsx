import React, { useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay, todayStr } from "@/lib/dates";

type Props = {
  label: string;
  value: string | null;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  onChange: (iso: string) => void;
};

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DatePickerField({
  label,
  value,
  placeholder = "Select date",
  minimumDate,
  maximumDate,
  onChange,
}: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => (value ? isoToDate(value) : isoToDate(todayStr())));

  const display = value ? formatDateDisplay(value) : placeholder;

  const openPicker = () => {
    setDraft(value ? isoToDate(value) : isoToDate(todayStr()));
    if (Platform.OS === "android") {
      setAndroidOpen(true);
      return;
    }
    setOpen(true);
  };

  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setAndroidOpen(false);
    if (event.type === "dismissed" || !selected) return;
    onChange(dateToIso(selected));
  };

  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        {label}
      </Text>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${display}`}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text style={{ flex: 1, color: value ? theme.colors.text : theme.colors.textMuted }}>
          {display}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>

      {androidOpen ? (
        <DateTimePicker
          value={draft}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={onAndroidChange}
        />
      ) : null}

      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)}>
        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(_, selected) => {
            if (selected) setDraft(selected);
          }}
          style={{ alignSelf: "center" }}
        />
        <Pressable
          onPress={() => {
            onChange(dateToIso(draft));
            setOpen(false);
          }}
          style={{
            marginTop: 12,
            paddingVertical: 12,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.tint,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

/** Ends: Never › or On date with native picker. */
export function EndsDateField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const theme = useTheme();
  const [modeOpen, setModeOpen] = useState(false);
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => (value ? isoToDate(value) : isoToDate(todayStr())));

  const display = useMemo(() => (value ? formatDateDisplay(value) : "Never"), [value]);

  const startOnDate = () => {
    setModeOpen(false);
    setDraft(value ? isoToDate(value) : isoToDate(todayStr()));
    if (Platform.OS === "android") {
      setAndroidOpen(true);
      return;
    }
    setIosPickerOpen(true);
  };

  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setAndroidOpen(false);
    if (event.type === "dismissed" || !selected) return;
    onChange(dateToIso(selected));
  };

  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>Ends</Text>
      <Pressable
        onPress={() => setModeOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Ends, ${display}`}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: theme.colors.surfaceMuted,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Text style={{ flex: 1, color: theme.colors.text }}>{display}</Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>

      <BottomSheet visible={modeOpen} title="Ends" onClose={() => setModeOpen(false)}>
        <Pressable
          onPress={() => {
            onChange(null);
            setModeOpen(false);
          }}
          style={{
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>Never</Text>
        </Pressable>
        <Pressable onPress={startOnDate} style={{ paddingVertical: 14 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>On date</Text>
        </Pressable>
      </BottomSheet>

      {androidOpen ? (
        <DateTimePicker value={draft} mode="date" display="default" onChange={onAndroidChange} />
      ) : null}

      <BottomSheet visible={iosPickerOpen} title="End date" onClose={() => setIosPickerOpen(false)}>
        <DateTimePicker
          value={draft}
          mode="date"
          display="spinner"
          onChange={(_, selected) => {
            if (selected) setDraft(selected);
          }}
          style={{ alignSelf: "center" }}
        />
        <Pressable
          onPress={() => {
            onChange(dateToIso(draft));
            setIosPickerOpen(false);
          }}
          style={{
            marginTop: 12,
            paddingVertical: 12,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.tint,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}
