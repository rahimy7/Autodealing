// The floating + button and what it creates, by profile.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { canSell, isAdmin, isService, useAuth } from "@/lib/auth";
import { CardList, Gradient, Icon, ListRow, Sheet, T, type IconName } from "@/components/ui";
import { colors } from "@/theme";

export function CreateButton() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const items: [string, IconName, string, string, () => void][] = [
    ["unit", "camera-outline", "Cargar vehículo", "Fotos y datos desde el lote", () => router.push("/units/new")],
    ...(canSell(user) ? ([["quote", "document-text-outline", "Nueva cotización", "Contado o pago mensual, por WhatsApp", () => router.push("/quote/new")]] as [string, IconName, string, string, () => void][]) : []),
    ["appt", "calendar-outline", isService(user) ? "Nueva cita de servicio" : "Nueva cita", isService(user) ? "Taller, entrega o llamada" : "Prueba de manejo, visita o entrega", () => router.push({ pathname: "/appointment", params: { kind: isService(user) ? "service" : "testdrive" } })],
    ...(canSell(user) ? ([["hold", "bookmark-outline", "Nueva reserva", "Aparta una unidad para un cliente", () => router.push("/reserve")]] as [string, IconName, string, string, () => void][]) : []),
    ...(isAdmin(user) ? ([["user", "people-outline", "Nuevo usuario", "Ventas, servicio o administración", () => router.push("/team/new")]] as [string, IconName, string, string, () => void][]) : []),
  ];
  return (
    <>
      <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: 74 + insets.bottom }}>
        <Pressable onPress={() => setOpen(true)} accessibilityLabel="Crear" style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.94 : 1 }], shadowColor: colors.accent2, shadowOpacity: 0.7, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 })}>
          <Gradient style={{ width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center" }}>
            <Icon name="add" size={30} color="#fff" />
          </Gradient>
        </Pressable>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Crear">
        <CardList>
          {items.map(([k, icon, label, sub, fn]) => (
            <ListRow
              key={k}
              onPress={() => {
                setOpen(false);
                setTimeout(fn, 120);
              }}
              left={
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
                  <Icon name={icon} size={20} />
                </View>
              }
              title={label}
              subtitle={sub}
              right={<Icon name="chevron-forward" size={18} color={colors.muted} />}
            />
          ))}
        </CardList>
        <T v="small" style={{ marginTop: 12 }}> </T>
      </Sheet>
    </>
  );
}
