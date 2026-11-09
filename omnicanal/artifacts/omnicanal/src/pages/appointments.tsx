import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAppointments,
  useCreateAppointment,
  useUpdateAppointment,
  useDeleteAppointment,
  useListContacts,
  useListAgents,
  getListAppointmentsQueryKey,
  type Appointment,
  type AppointmentStatus,
} from "@workspace/api-client-react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Trash2,
  Clock,
  MapPin,
  MessageSquare,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "Por confirmar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  completed: "Atendida",
  no_show: "No asistió",
};

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  completed: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  no_show: "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_ORDER: AppointmentStatus[] = ["pending", "confirmed", "completed", "no_show", "cancelled"];

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  // Semana de lunes a domingo, que es como se lee una agenda de trabajo.
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** "2026-08-15T15:00" — el valor que espera un <input type="datetime-local">. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface DraftAppointment {
  id: number | null;
  contactId: string;
  agentId: string;
  service: string;
  location: string;
  notes: string;
  startsAt: string;
  durationMinutes: string;
  status: AppointmentStatus;
}

function emptyDraft(startsAt: Date): DraftAppointment {
  return {
    id: null,
    contactId: "",
    agentId: "",
    service: "",
    location: "",
    notes: "",
    startsAt: toLocalInputValue(startsAt),
    durationMinutes: "60",
    status: "confirmed",
  };
}

export default function AppointmentsPage() {
  const { locale } = useClient();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [draft, setDraft] = useState<DraftAppointment | null>(null);

  const weekEnd = addDays(weekStart, 7);
  const { data: appointments, isLoading } = useListAppointments({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
  });
  const { data: contacts } = useListContacts();
  const { data: agents } = useListAgents();

  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();
  const deleteAppointment = useDeleteAppointment();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat("es-DO", { hour: "2-digit", minute: "2-digit", timeZone: locale.timezone }),
    [locale.timezone],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat("es-DO", { weekday: "long", day: "numeric", month: "short" }),
    [],
  );

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments ?? []) {
      const key = new Date(appointment.startsAt).toDateString();
      const list = map.get(key) ?? [];
      list.push(appointment);
      map.set(key, list);
    }
    return map;
  }, [appointments]);

  const bookedByAi = (appointments ?? []).filter((a) => a.source === "ai").length;

  const openNew = (day: Date) => {
    const startsAt = new Date(day);
    startsAt.setHours(9, 0, 0, 0);
    setDraft(emptyDraft(startsAt));
  };

  const openEdit = (appointment: Appointment) => {
    setDraft({
      id: appointment.id,
      contactId: String(appointment.contactId),
      agentId: appointment.agentId ? String(appointment.agentId) : "",
      service: appointment.service,
      location: appointment.location ?? "",
      notes: appointment.notes ?? "",
      startsAt: toLocalInputValue(new Date(appointment.startsAt)),
      durationMinutes: String(appointment.durationMinutes),
      status: appointment.status,
    });
  };

  // El 409 del servidor es un choque de horario, no un fallo: se traduce a un
  // aviso que dice qué pasó, en vez del "error inesperado" de siempre.
  const reportError = (err: unknown) => {
    const status = (err as { status?: number }).status;
    toast({
      title: status === 409 ? "Ese horario ya está ocupado" : "No se pudo guardar la cita",
      description:
        status === 409
          ? "Ya hay otra cita que se solapa con esa hora. Elige otra o ajusta la duración."
          : "Revisa los datos e intenta de nuevo.",
      variant: "destructive",
    });
  };

  const save = () => {
    if (!draft) return;
    if (!draft.contactId || !draft.service.trim()) {
      toast({ title: "Falta el contacto o el servicio", variant: "destructive" });
      return;
    }

    const payload = {
      contactId: Number(draft.contactId),
      agentId: draft.agentId ? Number(draft.agentId) : null,
      service: draft.service.trim(),
      location: draft.location.trim() || null,
      notes: draft.notes.trim() || null,
      startsAt: new Date(draft.startsAt).toISOString(),
      durationMinutes: Number(draft.durationMinutes) || 60,
      status: draft.status,
    };

    const done = () => {
      invalidate();
      setDraft(null);
      toast({ title: draft.id ? "Cita actualizada" : "Cita agendada" });
    };

    if (draft.id) {
      updateAppointment.mutate({ id: draft.id, data: payload }, { onSuccess: done, onError: reportError });
    } else {
      createAppointment.mutate({ data: payload }, { onSuccess: done, onError: reportError });
    }
  };

  const remove = (id: number) =>
    deleteAppointment.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          setDraft(null);
          toast({ title: "Cita eliminada" });
        },
      },
    );

  const setStatus = (appointment: Appointment, status: AppointmentStatus) =>
    updateAppointment.mutate(
      { id: appointment.id, data: { status } },
      { onSuccess: invalidate, onError: reportError },
    );

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Agenda</h1>
            <p className="text-sm text-muted-foreground">
              Citas de la semana
              {bookedByAi > 0 && (
                <>
                  {" · "}
                  <span className="text-primary font-medium">{bookedByAi} agendadas por el asistente</span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} data-testid="button-prev-week" aria-label="Semana anterior">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))} data-testid="button-this-week">
              Hoy
            </Button>
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} data-testid="button-next-week" aria-label="Semana siguiente">
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button onClick={() => openNew(new Date())} className="gap-2" data-testid="button-new-appointment">
              <Plus className="w-4 h-4" /> Nueva cita
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Cargando agenda…</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {days.map((day) => {
              const dayAppointments = (byDay.get(day.toDateString()) ?? []).slice().sort(
                (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
              );
              const today = isSameDay(day, new Date());

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "rounded-xl border bg-card p-3 flex flex-col gap-2 min-h-32",
                    today ? "border-primary/40 ring-1 ring-primary/20" : "border-card-border",
                  )}
                  data-testid={`day-${day.toISOString().slice(0, 10)}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("text-xs font-semibold capitalize", today ? "text-primary" : "text-foreground")}>
                      {dayFormatter.format(day)}
                    </span>
                    <button
                      onClick={() => openNew(day)}
                      className="text-muted-foreground hover:text-primary transition-colors"
                      aria-label={`Agendar el ${dayFormatter.format(day)}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {dayAppointments.length === 0 ? (
                    <div className="text-xs text-muted-foreground/60 py-3 text-center">Sin citas</div>
                  ) : (
                    dayAppointments.map((appointment) => (
                      <button
                        key={appointment.id}
                        onClick={() => openEdit(appointment)}
                        className="text-left rounded-lg border border-border bg-background p-2.5 hover:border-primary/40 transition-colors"
                        data-testid={`appointment-${appointment.id}`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {timeFormatter.format(new Date(appointment.startsAt))}
                          <span className="text-muted-foreground font-normal">
                            · {appointment.durationMinutes} min
                          </span>
                          {appointment.source === "ai" && (
                            <Sparkles className="w-3 h-3 text-primary ml-auto" aria-label="Agendada por el asistente" />
                          )}
                        </div>

                        <div className="mt-1 text-sm font-medium text-foreground truncate">
                          {appointment.service}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {appointment.contactName ?? `Contacto #${appointment.contactId}`}
                        </div>

                        {appointment.location && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                            <MapPin className="w-3 h-3 flex-shrink-0" /> {appointment.location}
                          </div>
                        )}

                        <span
                          className={cn(
                            "mt-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            STATUS_STYLES[appointment.status],
                          )}
                        >
                          {STATUS_LABELS[appointment.status]}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Las citas que dejó el asistente y nadie ha mirado: es lo primero que
            el equipo tiene que atender cada mañana, así que va aparte. */}
        {(appointments ?? []).some((a) => a.status === "pending") && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-foreground">Por confirmar</span>
            </div>
            <div className="space-y-2">
              {(appointments ?? [])
                .filter((a) => a.status === "pending")
                .map((appointment) => (
                  <div
                    key={appointment.id}
                    className="flex items-center gap-3 flex-wrap rounded-lg bg-background border border-border p-2.5"
                  >
                    <span className="text-sm font-medium text-foreground">{appointment.service}</span>
                    <span className="text-xs text-muted-foreground">
                      {appointment.contactName ?? `Contacto #${appointment.contactId}`} ·{" "}
                      {dayFormatter.format(new Date(appointment.startsAt))}{" "}
                      {timeFormatter.format(new Date(appointment.startsAt))}
                    </span>
                    {appointment.conversationId && (
                      <a
                        href={`/inbox?conversation=${appointment.conversationId}`}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <MessageSquare className="w-3 h-3" /> ver chat
                      </a>
                    )}
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setStatus(appointment, "cancelled")}>
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={() => setStatus(appointment, "confirmed")} data-testid={`confirm-${appointment.id}`}>
                        Confirmar
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar cita" : "Nueva cita"}</DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Contacto</label>
                <select
                  value={draft.contactId}
                  onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  data-testid="select-appointment-contact"
                >
                  <option value="">Selecciona un contacto…</option>
                  {(contacts ?? []).map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Servicio</label>
                <input
                  value={draft.service}
                  onChange={(e) => setDraft({ ...draft, service: e.target.value })}
                  placeholder="Corte, asesoría, visita técnica…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  data-testid="input-appointment-service"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Fecha y hora</label>
                  <input
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    data-testid="input-appointment-startsat"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Duración (min)</label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={draft.durationMinutes}
                    onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Atiende</label>
                  <select
                    value={draft.agentId}
                    onChange={(e) => setDraft({ ...draft, agentId: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Sin asignar</option>
                    {(agents ?? [])
                      .filter((agent) => agent.type === "human")
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Estado</label>
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as AppointmentStatus })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Lugar</label>
                <input
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  placeholder="Sucursal o dirección"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Notas</label>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {draft?.id ? (
              <Button variant="outline" onClick={() => remove(draft.id!)} className="gap-2 text-destructive">
                <Trash2 className="w-4 h-4" /> Eliminar
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button onClick={save} data-testid="button-save-appointment">
                {draft?.id ? "Guardar" : "Agendar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
