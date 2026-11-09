import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListCases, useCreateCase, useGetCase, useUpdateCase, useAddCaseEvent, useResolveCase,
  useListContacts, useListAgents, getListCasesQueryKey, getGetCaseQueryKey, getListContactsQueryKey,
  type CaseType, type CaseStatus, type CasePriority } from "@workspace/api-client-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CASE_TYPE_LABELS, CASE_PRIORITY_LABELS } from "@/components/CaseBadge";

const TYPES = ["prayer_request", "visitation", "bible_study", "worship"] as const;
const STATUSES: Record<CaseStatus, string> = { open: "Pendiente", in_progress: "En atención", waiting_customer: "Esperando respuesta", resolved: "Atendida", cancelled: "Cancelada" };
const date = (value: string | Date | null | undefined) => value ? (value instanceof Date ? value : new Date(value)).toLocaleString("es-DO") : "—";

export default function PastoralRequestsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryString = useSearch();
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [status, setStatus] = useState("pending");
  const [filter, setFilter] = useState<CaseType | "all">("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const { data: requests, isLoading, error } = useListCases({ status: status === "all" ? undefined : status as never, type: filter === "all" ? undefined : filter, search: debounced || undefined });
  const { data: detail, isLoading: detailLoading } = useGetCase(selected ?? 0, { query: { enabled: selected !== null, queryKey: getGetCaseQueryKey(selected ?? 0) } });
  const { data: agents } = useListAgents();
  const create = useCreateCase(), update = useUpdateCase(), addNote = useAddCaseEvent(), resolve = useResolveCase();
  const [contactSearch, setContactSearch] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setContactQuery(contactSearch.trim()), 250); return () => clearTimeout(timer); }, [contactSearch]);
  const params = { search: contactQuery || undefined };
  const { data: contacts } = useListContacts(params, { query: { enabled: newOpen && contactQuery.length > 1, queryKey: getListContactsQueryKey(params) } });
  const [contact, setContact] = useState<{ id: number; name: string } | null>(null);
  const [type, setType] = useState<CaseType>("prayer_request");
  const [priority, setPriority] = useState<CasePriority>("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [action, setAction] = useState("");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  useEffect(() => { const id = Number(new URLSearchParams(queryString).get("case")); if (Number.isInteger(id) && id > 0) { setSelected(id); navigate("/cases", { replace: true }); } }, [queryString, navigate]);
  useEffect(() => { setNote(""); setResolution(""); }, [selected]);
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); if (selected !== null) queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(selected) }); };
  const fail = () => toast({ title: "No se pudo guardar la petición", variant: "destructive" });
  const patch = (data: Parameters<typeof update.mutate>[0]["data"]) => { if (selected !== null) update.mutate({ id: selected, data }, { onSuccess: invalidate, onError: fail }); };
  const openNew = () => { setContact(null); setContactSearch(""); setContactQuery(""); setType("prayer_request"); setPriority("normal"); setSubject(""); setDescription(""); setAction(""); setNewOpen(true); };
  const submit = () => {
    if (!contact || !subject.trim()) { toast({ title: "Selecciona una persona y escribe el asunto", variant: "destructive" }); return; }
    create.mutate({ data: { contactId: contact.id, type, priority, subject: subject.trim(), description: description.trim() || null, requestedAction: action.trim() || null } }, {
      onSuccess: row => { setNewOpen(false); setSelected(row.id); invalidate(); toast({ title: "Petición registrada", description: row.code }); }, onError: fail,
    });
  };
  const row = detail?.case;
  return <Layout><div className="p-6 space-y-5">
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h1 className="text-xl font-bold">Peticiones</h1><p className="text-sm text-muted-foreground">Oración, visitación, estudios bíblicos y cultos de Linaje Real.</p></div><Button onClick={openNew} data-testid="button-new-request">Nueva petición</Button></div>
    <div className="flex flex-wrap gap-2">
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendientes de atención</SelectItem><SelectItem value="resolved">Atendidas</SelectItem><SelectItem value="cancelled">Canceladas</SelectItem><SelectItem value="all">Todas</SelectItem></SelectContent></Select>
      <Select value={filter} onValueChange={value => setFilter(value as CaseType | "all")}><SelectTrigger className="w-52" aria-label="Filtrar por tipo" data-testid="select-request-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{TYPES.map(t => <SelectItem key={t} value={t}>{CASE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
      <Input aria-label="Buscar peticiones" placeholder="Buscar persona, asunto o código…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-48" />
    </div>
    {isLoading ? <p role="status">Cargando peticiones…</p> : error ? <p role="alert">No se pudieron cargar las peticiones.</p> : <div className="rounded-xl border border-card-border overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Peticiones de la iglesia</caption><thead className="bg-muted/30"><tr>{["Código", "Persona", "Petición", "Tipo", "Estado", "Responsable", "Fecha"].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{(requests ?? []).map(r => <tr key={r.id} className="border-t border-card-border"><td className="p-3">{r.code}</td><td className="p-3">{r.contactName ?? "Sin nombre"}</td><td className="p-3"><button className="text-primary text-left hover:underline" onClick={() => setSelected(r.id)}>{r.subject}</button></td><td className="p-3">{CASE_TYPE_LABELS[r.type] ?? "Petición anterior"}</td><td className="p-3">{STATUSES[r.status]}</td><td className="p-3">{r.assignedAgentName ?? "Sin asignar"}</td><td className="p-3 whitespace-nowrap">{date(r.createdAt)}</td></tr>)}</tbody></table>{!requests?.length && <p className="p-8 text-center text-muted-foreground">No hay peticiones con estos filtros.</p>}</div>}
  </div>
  <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Nueva petición</DialogTitle><DialogDescription>Registra la solicitud para que el equipo de la iglesia le dé seguimiento. Las visitas, estudios y cultos se coordinan con la persona.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div><Label htmlFor="request-contact">Persona</Label>{contact ? <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2"><span>{contact.name}</span><Button variant="ghost" onClick={() => setContact(null)}>Cambiar</Button></div> : <><Input id="request-contact" placeholder="Buscar en contactos…" value={contactSearch} onChange={e => setContactSearch(e.target.value)} />{contactQuery.length > 1 && <div className="max-h-36 overflow-y-auto">{(contacts ?? []).slice(0, 8).map(c => <button type="button" key={c.id} className="block w-full text-left p-2 hover:bg-muted" onClick={() => setContact({ id: c.id, name: c.name })}>{c.name} · {c.phone ?? c.email ?? ""}</button>)}</div>}</>}</div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="request-type">Tipo de petición</Label><Select value={type} onValueChange={v => setType(v as CaseType)}><SelectTrigger id="request-type" data-testid="select-request-type"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{CASE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="request-priority">Prioridad</Label><Select value={priority} onValueChange={v => setPriority(v as CasePriority)}><SelectTrigger id="request-priority"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CASE_PRIORITY_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div></div>
      <div><Label htmlFor="request-subject">Asunto</Label><Input id="request-subject" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Ej.: Solicita una visita pastoral" /></div>
      <div><Label htmlFor="request-description">Descripción</Label><Textarea id="request-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Escribe solo lo necesario para atender la petición." /></div>
      <div><Label htmlFor="request-action">Seguimiento solicitado</Label><Input id="request-action" value={action} onChange={e => setAction(e.target.value)} placeholder="Ej.: Coordinar con el equipo de visitación" /></div>
      <Button onClick={submit} disabled={create.isPending} className="w-full" data-testid="button-save-request">{create.isPending ? "Guardando…" : "Registrar petición"}</Button>
    </div>
  </DialogContent></Dialog>
  <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{row ? `${row.code} · ${CASE_TYPE_LABELS[row.type] ?? "Petición"}` : "Petición"}</DialogTitle><DialogDescription>{row?.subject ?? "Detalle y seguimiento de la solicitud."}</DialogDescription></DialogHeader>
    {detailLoading ? <p role="status">Cargando…</p> : !row ? <p role="alert">No se pudo cargar la petición.</p> : <div className="space-y-4">
      <div><p className="font-medium">{row.contactName ?? "Sin nombre"}</p><p className="text-xs text-muted-foreground">{[row.contactPhone, row.contactEmail].filter(Boolean).join(" · ")}</p></div>
      <div className="grid grid-cols-2 gap-3"><div><Label>Estado</Label><Select value={row.status} onValueChange={v => patch({ status: v as CaseStatus })} disabled={update.isPending}><SelectTrigger aria-label="Estado de la petición"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUSES).filter(([key]) => key !== "resolved" || row.status === "resolved").map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Responsable</Label><Select value={row.assignedAgentId ? String(row.assignedAgentId) : "none"} onValueChange={v => patch({ assignedAgentId: v === "none" ? null : Number(v) })} disabled={update.isPending}><SelectTrigger aria-label="Responsable de la petición"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin asignar</SelectItem>{(agents ?? []).filter(a => a.type === "human").map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent></Select></div></div>
      {row.description && <div className="rounded-lg bg-muted/30 p-3 whitespace-pre-wrap">{row.description}</div>}{row.requestedAction && <p><strong>Seguimiento solicitado:</strong> {row.requestedAction}</p>}
      {row.conversationId && <Button variant="outline" onClick={() => navigate(`/inbox?conv=${row.conversationId}`)}>Ver conversación</Button>}
      <div><h3 className="font-semibold">Seguimiento</h3><div className="space-y-2 my-2">{(detail?.events ?? []).map(event => <div key={event.id} className="border-l-2 border-card-border pl-3 text-sm"><p className="text-xs text-muted-foreground">{date(event.createdAt)}{event.agentName ? ` · ${event.agentName}` : ""}</p><p className="whitespace-pre-wrap">{event.body}</p></div>)}</div><Label htmlFor="request-note">Añadir nota</Label><Textarea id="request-note" value={note} onChange={e => setNote(e.target.value)} /><Button className="mt-2" variant="outline" disabled={addNote.isPending || !note.trim()} onClick={() => addNote.mutate({ id: row.id, data: { kind: "note", body: note.trim() } }, { onSuccess: () => { setNote(""); invalidate(); }, onError: fail })}>Guardar nota</Button></div>
      {row.resolution && <p className="rounded-lg bg-green-500/10 p-3"><strong>Atención realizada:</strong> {row.resolution}</p>}
      {row.status !== "resolved" && row.status !== "cancelled" && <div className="border-t border-card-border pt-3"><Label htmlFor="request-resolution">Atención realizada</Label><Textarea id="request-resolution" value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Indica qué atención o coordinación se realizó." /><Button className="mt-2" disabled={resolve.isPending || !resolution.trim()} onClick={() => resolve.mutate({ id: row.id, data: { kind: "actioned", resolution: resolution.trim() } }, { onSuccess: () => { invalidate(); toast({ title: "Petición marcada como atendida" }); }, onError: fail })}>Marcar como atendida</Button></div>}
    </div>}
  </DialogContent></Dialog>
  </Layout>;
}
