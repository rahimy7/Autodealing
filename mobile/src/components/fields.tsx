// Date and time fields that open the phone's own pickers. Values are the dealership's wall clock
// as text ("2026-11-20", "15:30"), which is what the API takes.
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { dayLabel } from "@/lib/format";
import { Button, Sheet, T } from "@/components/ui";
import { colors, font, radius } from "@/theme";

const box = { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const };

function PickerField({ label, text, icon, mode, value, onPick }: { label: string; text: string; icon: "calendar-outline" | "time-outline"; mode: "date" | "time"; value: Date; onPick: (d: Date) => void }) {
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const open = () => {
    if (Platform.OS === "android") DateTimePickerAndroid.open({ value, mode, is24Hour: false, onChange: (_e, d) => d && onPick(d) });
    else {
      setDraft(value);
      setIosOpen(true);
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <Pressable onPress={open} style={box}>
        <Text style={{ fontFamily: font.medium, fontSize: 16, color: colors.text }}>{text}</Text>
        <Ionicons name={icon} size={18} color={colors.muted} />
      </Pressable>
      {Platform.OS === "ios" ? (
        <Sheet visible={iosOpen} onClose={() => setIosOpen(false)} title={label} footer={<Button title="Listo" onPress={() => (onPick(draft), setIosOpen(false))} full />}>
          <DateTimePicker value={draft} mode={mode} display="spinner" themeVariant="dark" onChange={(_e, d) => d && setDraft(d)} />
        </Sheet>
      ) : null}
    </View>
  );
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1, 12);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <PickerField
      label={label}
      mode="date"
      icon="calendar-outline"
      value={date}
      text={dayLabel(value, { weekday: "short", day: "numeric", month: "short" })}
      onPick={(p) => onChange(`${p.getFullYear()}-${pad(p.getMonth() + 1)}-${pad(p.getDate())}`)}
    />
  );
}
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [h, mi] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, h || 0, mi || 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hour12 = ((h || 0) % 12) || 12;
  return (
    <PickerField
      label={label}
      mode="time"
      icon="time-outline"
      value={date}
      text={`${hour12}:${pad(mi || 0)} ${(h || 0) >= 12 ? "p. m." : "a. m."}`}
      onPick={(p) => onChange(`${pad(p.getHours())}:${pad(p.getMinutes())}`)}
    />
  );
}
