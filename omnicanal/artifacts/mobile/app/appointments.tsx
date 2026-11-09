import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAppointments,
  useUpdateAppointment,
  useDeleteAppointment,
  getListAppointmentsQueryKey,
  type Appointment,
  type AppointmentStatus,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Card, Chips, EmptyState, ListRow, Loading, SectionHeader } from "../src/components/ui";
import { errorMessage, formatTime } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

// La agenda: citas que acordó el agente virtual mientras hablaba con el cliente
// y las que puso el equipo. Lo que se hace desde el teléfono es confirmarlas y
// marcar lo que pasó; crearlas con su hueco y su disponibilidad sigue en el panel.

const RANGES = ["today", "upcoming", "past"] as const;
const RANGE_LABELS: Record<string, string> = { today: "Hoy", upcoming: "Próximas", past: "Pasadas" };

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "Por confirmar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Completada",
  no_show: "No se presentó",
};

const STATUS_TINT: Record<AppointmentStatus, { bg: string; fg: string }> = {
  pending: { bg: colors.warningSoft, fg: colors.warning },
  confirmed: { bg: colors.successSoft, fg: colors.success },
  cancelled: { bg: colors.muted, fg: colors.mutedForeground },
  completed: { bg: colors.infoSoft, fg: colors.info },
  no_show: { bg: colors.destructiveSoft, fg: colors.destructive },
};

const NEXT_STATUSES: Array<{ status: AppointmentStatus; icon: "checkmark-circle" | "checkmark-done" | "close-circle" | "person-remove" }> = [
  { status: "confirmed", icon: "checkmark-circle" },
  { status: "completed", icon: "checkmark-done" },
  { status: "no_show", icon: "person-remove" },
  { status: "cancelled", icon: "close-circle" },
];

// Los días se arman con la fecha del teléfono, que es la del negocio: quien mira
// la agenda está en el mismo sitio que el cliente que viene a la cita.
function dayStart(offsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function dayTitle(value: string): string {
  const date = new Date(value);
  const today = dayStart(0);
  const tomorrow = dayStart(1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoy";
  if (sameDay(date, tomorrow)) return "Mañana";
  return date.toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });
}

export default function AppointmentsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<(typeof RANGES)[number]>("upcoming");
  const [selected, setSelected] = useState<Appointment | null>(null);

  const params = useMemo(() => {
    if (range === "today") return { from: dayStart(0).toISOString(), to: dayStart(1).toISOString() };
    if (range === "past") return { from: dayStart(-30).toISOString(), to: dayStart(0).toISOString() };
    return { from: dayStart(0).toISOString(), to: dayStart(30).toISOString() };
  }, [range]);

  const { data, isLoading, isFetching, refetch } = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params) },
  });
  const updateAppointment = useUpdateAppointment();
  const deleteAppointment = useDeleteAppointment();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });

  // Una tarjeta por día, en orden: es como se lee una agenda.
  const days = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const appointment of [...(data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
      const key = appointment.startsAt.slice(0, 10);
      const rows = groups.get(key);
      if (rows) rows.push(appointment);
      else groups.set(key, [appointment]);
    }
    return Array.from(groups.entries());
  }, [data]);

  const changeStatus = (appointment: Appointment, status: AppointmentStatus) =>
    updateAppointment.mutate(
      { id: appointment.id, data: { status } },
      {
        onSuccess: (updated) => {
          setSelected(updated);
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)),
      },
    );

  const remove = (appointment: Appointment) =>
    Alert.alert("Eliminar la cita", `Se borra "${appointment.service}" de la agenda.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteAppointment.mutate(
            { id: appointment.id },
            {
              onSuccess: () => {
                setSelected(null);
                invalidate();
              },
              onError: (err) => Alert.alert("No se pudo eliminar", errorMessage(err)),
            },
          ),
      },
    ]);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Chips options={RANGES} value={range} onChange={setRange} labels={RANGE_LABELS} />

      {isLoading && days.length === 0 ? (
        <Loading label="Cargando la agenda…" />
      ) : days.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Sin citas"
          description={range === "past" ? "No hubo citas en los últimos 30 días." : "Aquí caen las que acuerde la IA y las que ponga el equipo."}
        />
      ) : (
        days.map(([day, rows]) => (
          <Card key={day} padded={false} style={{ overflow: "hidden" }}>
            <View style={styles.dayHeader}>
              <SectionHeader title={dayTitle(rows[0].startsAt)} />
            </View>
            {rows.map((appointment, index) => {
              const tint = STATUS_TINT[appointment.status];
              return (
                <View key={appointment.id}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <ListRow
                    title={`${formatTime(appointment.startsAt)} · ${appointment.service}`}
                    subtitle={appointment.contactName ?? "Sin nombre"}
                    onPress={() => setSelected(appointment)}
                    meta={
                      <View style={styles.metaRow}>
                        <Badge label={STATUS_LABELS[appointment.status]} bg={tint.bg} fg={tint.fg} />
                        <Badge label={`${appointment.durationMinutes} min`} icon="time" />
                        {appointment.source === "ai" ? (
                          <Badge label="Acordada por la IA" bg={colors.botSoft} fg={colors.bot} icon="sparkles" />
                        ) : null}
                        {appointment.agentName ? <Badge label={appointment.agentName} icon="person" /> : null}
                      </View>
                    }
                  />
                </View>
              );
            })}
          </Card>
        ))
      )}

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.service ?? ""}
        description={
          selected
            ? `${dayTitle(selected.startsAt)} · ${formatTime(selected.startsAt)} · ${STATUS_LABELS[selected.status]}`
            : undefined
        }
      >
        {selected ? (
          <View style={styles.detail}>
            <Text style={styles.meta}>Cliente: {selected.contactName ?? "Sin nombre"}</Text>
            {selected.contactPhone ? <Text style={styles.meta}>Teléfono: {selected.contactPhone}</Text> : null}
            {selected.location ? <Text style={styles.meta}>Dónde: {selected.location}</Text> : null}
            {selected.agentName ? <Text style={styles.meta}>Atiende: {selected.agentName}</Text> : null}
            {selected.notes ? <Text style={styles.body}>{selected.notes}</Text> : null}
          </View>
        ) : null}

        {selected?.conversationId ? (
          <SheetAction
            icon="chatbubbles"
            label="Abrir la conversación"
            onPress={() => {
              const id = selected.conversationId;
              setSelected(null);
              router.push(`/chat/${id}`);
            }}
          />
        ) : null}

        {selected
          ? NEXT_STATUSES.filter((option) => option.status !== selected.status).map((option) => (
              <SheetAction
                key={option.status}
                icon={option.icon}
                label={STATUS_LABELS[option.status]}
                tint={option.status === "cancelled" || option.status === "no_show" ? colors.destructive : colors.foreground}
                disabled={updateAppointment.isPending}
                onPress={() => changeStatus(selected, option.status)}
              />
            ))
          : null}

        {selected ? (
          <SheetAction
            icon="trash"
            label="Eliminar la cita"
            tint={colors.destructive}
            disabled={deleteAppointment.isPending}
            onPress={() => remove(selected)}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 3 },
  body: { fontSize: 13, color: colors.foreground, lineHeight: 19, marginTop: 4 },
  meta: { fontSize: 12, color: colors.mutedForeground },
});
