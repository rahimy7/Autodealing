import { useContactTags } from "@/hooks/use-contact-tags";
import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetContact,
  useUpdateContact,
  useListConversations,
  useListMessages,
  useCreateContactFact,
  useDeleteContactFact,
  useListEmailThreads,
  useListContacts,
  useMergeContact,
  getGetContactQueryKey,
  getListConversationsQueryKey,
  getListEmailThreadsQueryKey,
  getListContactsQueryKey,
  type Contact,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft, Pencil, MessageSquare, Phone, Mail, Building2, MapPin,
  Cake, Calendar, Bot, Mic, X, Save, ShoppingBag, Sparkles, Plus, Trash2, Brain,
  Merge, Search, Loader2,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook, SiGmail } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import MetaContactProfile from "@/components/MetaContactProfile";
import ContactAvatar from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useModules } from "@/lib/platform";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import ChatMessages from "@/components/ChatMessages";
import ComposeEmailDialog from "@/components/email/ComposeEmailDialog";

const TAG_STYLES: Record<string, string> = {
  jovenes: "bg-yellow-500/15 text-yellow-600",
  junta: "bg-purple-500/15 text-purple-600",
  visitas: "bg-orange-500/15 text-orange-600",
  miembros: "bg-green-500/15 text-green-600",
  lead: "bg-blue-500/15 text-blue-400",
  vip: "bg-yellow-500/15 text-yellow-400",
  in_process: "bg-purple-500/15 text-purple-400",
  support: "bg-red-500/15 text-red-400",
};


const STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  resolved: "Resuelta",
  bot: "Bot",
  pending: "Pendiente",
};

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: (props) => <SiWhatsapp {...props} />,
  instagram: (props) => <SiInstagram {...props} />,
  facebook: (props) => <SiFacebook {...props} />,
  email: (props) => <SiGmail {...props} />,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
  email: "text-[#EA4335]",
};

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  company: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  birthday: z.string().optional(),
  tag: z.enum(["lead", "vip", "in_process", "support", "jovenes", "junta", "visitas", "miembros"]).optional(),
  notes: z.string().optional(),
  buyerStatus: z.string().optional(),
  interests: z.string().optional(),
  purchaseProfile: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function fmtDate(date?: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
        <div className="text-sm text-foreground break-words">{value || <span className="text-muted-foreground/50">—</span>}</div>
      </div>
    </div>
  );
}

function ProfileCard({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient();
  const createFact = useCreateContactFact();
  const deleteFact = useDeleteContactFact();
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
  const addFact = () => {
    if (!label.trim() || !value.trim()) return;
    createFact.mutate({ id: contact.id, data: { label: label.trim(), value: value.trim() } }, { onSuccess: () => { invalidate(); setLabel(""); setValue(""); } });
  };
  const interests = contact.interests ?? [];
  const facts = contact.facts ?? [];
  const hasProfile = contact.buyerStatus || interests.length || contact.purchaseProfile || facts.length;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <ShoppingBag className="w-4 h-4 text-primary" /> Perfil comercial
        <span className="text-[10px] font-normal text-muted-foreground flex items-center gap-1 ml-1"><Sparkles className="w-3 h-3" /> auto-llenado por IA</span>
      </h2>
      {!hasProfile && <p className="text-xs text-muted-foreground mb-3">Aún sin datos de perfil. La IA lo completará a medida que converse con el contacto.</p>}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Estado</div>
          <div className="mt-1">
            {contact.buyerStatus ? <span className="capitalize inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{contact.buyerStatus}</span> : <span className="text-muted-foreground/50 text-sm">—</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Intereses</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {interests.map((it, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground">{it}</span>)}
            {interests.length === 0 && <span className="text-muted-foreground/50 text-sm">—</span>}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Perfil de compra</div>
        <p className="text-sm text-foreground mt-0.5">{contact.purchaseProfile || <span className="text-muted-foreground/50">—</span>}</p>
      </div>
      <div className="mt-4 pt-4 border-t border-card-border/50">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-2 flex items-center gap-1.5"><Brain className="w-3.5 h-3.5" /> Datos relevantes</div>
        <div className="space-y-1.5">
          {facts.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm" data-testid={`fact-${f.id}`}>
              <span className="text-muted-foreground text-xs font-medium flex-shrink-0">{f.label}:</span>
              <span className="text-foreground truncate flex-1">{f.value}</span>
              {f.source === "ai" && <Sparkles className="w-3 h-3 text-primary/60 flex-shrink-0" />}
              <button onClick={() => deleteFact.mutate({ id: f.id }, { onSuccess: invalidate })} className="p-0.5 text-muted-foreground hover:text-red-400 flex-shrink-0" data-testid={`delete-fact-${f.id}`}><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
          {facts.length === 0 && <p className="text-xs text-muted-foreground/50">Sin datos aún.</p>}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dato" className="h-8 text-xs w-28" data-testid="input-fact-label" />
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Valor" className="h-8 text-xs flex-1" data-testid="input-fact-value" />
          <Button size="sm" className="h-8 flex-shrink-0" onClick={addFact} disabled={createFact.isPending || !label.trim() || !value.trim()} data-testid="button-add-fact"><Plus className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}

function ConversationThread({ conversationId }: { conversationId: number }) {
  const { data: messages, isLoading } = useListMessages(conversationId);

  if (isLoading) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Cargando mensajes...</div>;
  }

  return (
    <div className="px-4 py-3 space-y-1.5 max-h-[420px] overflow-y-auto chat-wallpaper">
      <ChatMessages messages={messages ?? []} testIdPrefix="detail-message" />
      {(messages ?? []).length === 0 && (
        <div className="p-6 text-center text-sm text-muted-foreground">No hay mensajes en esta conversación</div>
      )}
    </div>
  );
}

// Los hilos de correo de esta persona. Viven en la sección Correo; aquí se listan
// para que la ficha muestre todo lo que el cliente ha escrito, por cualquier vía.
function EmailThreadsCard({ contact }: { contact: Contact }) {
  const [, setLocation] = useLocation();
  const [composeOpen, setComposeOpen] = useState(false);
  const params = { contactId: contact.id };
  const { data } = useListEmailThreads(params, { query: { queryKey: getListEmailThreadsQueryKey(params) } });
  const threads = data?.threads ?? [];

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <SiGmail className="w-3.5 h-3.5 text-[#EA4335]" /> Correos
          <span className="text-xs text-muted-foreground font-normal">{threads.length}</span>
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-7 text-xs"
          onClick={() => setComposeOpen(true)}
          data-testid="button-compose-email-contact"
        >
          <Mail className="w-3.5 h-3.5" /> Enviar correo
        </Button>
      </div>
      <div className="divide-y divide-card-border/50 max-h-[320px] overflow-y-auto">
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => setLocation(`/email?thread=${t.id}`)}
            className="w-full text-left px-5 py-3 hover:bg-muted/20 transition-colors"
            data-testid={`email-thread-item-${t.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground truncate">{t.subject ?? "(sin asunto)"}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmtDate(t.lastMessageAt)}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{t.lastMessagePreview ?? "—"}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              {t.customerEmail} · {t.status === "resolved" ? "Resuelto" : "Abierto"}
            </p>
          </button>
        ))}
        {threads.length === 0 && (
          <div className="px-5 py-8 text-center">
            <Mail className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin correos de este contacto</p>
          </div>
        )}
      </div>
      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        prefill={{ to: contact.email ?? "", contactId: contact.id, subject: "" }}
        onSent={(threadId) => setLocation(`/email?thread=${threadId}`)}
      />
    </div>
  );
}

// Une a esta ficha otra de la misma persona (la de WhatsApp y la de correo, por
// ejemplo). Esta se queda; la elegida le entrega todo y desaparece.
function MergeContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!open) {
      setSearch("");
      setPicked(null);
    }
  }, [open]);

  const params = { search: debounced };
  const { data, isFetching } = useListContacts(params, {
    query: { queryKey: getListContactsQueryKey(params), enabled: open && debounced.length >= 2 },
  });
  const results = (data ?? []).filter((c) => c.id !== contact.id).slice(0, 12);
  const merge = useMergeContact();

  const confirm = () => {
    if (!picked) return;
    merge.mutate(
      { id: contact.id, data: { sourceContactId: picked.id } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) });
          void queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey({ contactId: contact.id }) });
          void queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey({ contactId: contact.id }) });
          void queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
          toast({ title: "Contactos unidos", description: `${picked.name} ahora forma parte de ${contact.name}.` });
          onOpenChange(false);
        },
        onError: () => toast({ title: "No se pudieron unir los contactos", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Unir con otro contacto</DialogTitle>
          <DialogDescription>
            Para cuando la misma persona tiene dos fichas, por ejemplo una de WhatsApp y otra de correo.
          </DialogDescription>
        </DialogHeader>
        {picked ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{picked.name}</span> se unirá a <span className="font-semibold">{contact.name}</span>: sus
              conversaciones, correos, citas y datos pasan a esta ficha y la otra desaparece. Esto no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPicked(null)}>Volver</Button>
              <Button onClick={confirm} disabled={merge.isPending} data-testid="button-confirm-merge">
                {merge.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Unir contactos
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono o correo…"
                className="pl-9"
                autoFocus
                data-testid="input-merge-search"
              />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {debounced.length < 2 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">Escribe al menos dos letras para buscar.</p>
              ) : isFetching && results.length === 0 ? (
                <div className="p-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
              ) : results.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">Ningún contacto coincide.</p>
              ) : (
                results.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <ContactAvatar name={c.name} avatar={c.avatar} className="w-8 h-8 bg-primary/15 text-xs font-semibold text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
                        {(c.channels ?? []).map((ch) => {
                          const Icon = CHANNEL_ICONS[ch];
                          return Icon ? <Icon key={ch} className={`w-3 h-3 ${CHANNEL_COLORS[ch] ?? ""}`} /> : null;
                        })}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin teléfono ni correo"}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPicked(c)}>Elegir</Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ContactDetailPage() {
  const { labels: TAG_LABELS, options: tagOptions } = useContactTags();
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const modules = useModules();

  const { data: contact, isLoading } = useGetContact(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetContactQueryKey(id) },
  });
  const { data: conversations } = useListConversations(
    { contactId: id },
    { query: { enabled: Number.isFinite(id), queryKey: getListConversationsQueryKey({ contactId: id }) } }
  );
  const updateContact = useUpdateContact();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: contact
      ? {
          name: contact.name,
          phone: contact.phone ?? "",
          email: contact.email ?? "",
          company: contact.company ?? "",
          address: contact.address ?? "",
          city: contact.city ?? "",
          birthday: contact.birthday ?? "",
          tag: contact.tag ?? undefined,
          notes: contact.notes ?? "",
          buyerStatus: contact.buyerStatus ?? "",
          interests: (contact.interests ?? []).join(", "),
          purchaseProfile: contact.purchaseProfile ?? "",
        }
      : undefined,
  });

  const onSubmit = (values: FormValues) => {
    const { interests, buyerStatus, purchaseProfile, ...rest } = values;
    updateContact.mutate(
      {
        id,
        data: {
          ...rest,
          email: values.email || undefined,
          buyerStatus: buyerStatus || null,
          purchaseProfile: purchaseProfile || null,
          interests: interests ? interests.split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(id) });
          setEditing(false);
          toast({ title: "Contacto actualizado", description: "Los cambios se guardaron correctamente." });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="p-8 text-center text-muted-foreground text-sm">Cargando contacto...</div>
      </Layout>
    );
  }

  if (!contact) {
    return (
      <Layout>
        <div className="p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Contacto no encontrado</p>
          <Button variant="outline" onClick={() => setLocation("/contacts")}>Volver a contactos</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setLocation("/contacts")} data-testid="button-back-contacts">
              <ArrowLeft className="w-4 h-4" /> Contactos
            </Button>
          </div>
          {!editing && (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setMergeOpen(true)} data-testid="button-merge-contact">
                <Merge className="w-4 h-4" /> Unir contacto
              </Button>
              <Button className="gap-2" onClick={() => setEditing(true)} data-testid="button-edit-contact">
                <Pencil className="w-4 h-4" /> Editar
              </Button>
            </div>
          )}
        </div>

        {/* Identity card */}
        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center gap-4">
            <ContactAvatar
              name={contact.name}
              avatar={contact.avatar}
              className="w-14 h-14 bg-primary/20 text-xl font-bold text-primary"
            />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground truncate">{contact.name}</h1>
              <MetaContactProfile contact={contact} />
              <div className="flex items-center gap-2 mt-1">
                {contact.tag && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TAG_STYLES[contact.tag]}`}>
                    {TAG_LABELS[contact.tag]}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="w-3.5 h-3.5" /> {contact.totalConversations} conversaciones
                </span>
                <div className="flex items-center gap-1.5">
                  {(contact.channels ?? []).map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    return Icon ? <Icon key={ch} className={`w-3.5 h-3.5 ${CHANNEL_COLORS[ch] ?? ""}`} /> : null;
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {editing ? (
          /* Edit form */
          <div className="bg-card border border-card-border rounded-xl p-5">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre completo</FormLabel>
                    <FormControl><Input {...field} data-testid="input-edit-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Teléfono</FormLabel>
                      <FormControl><Input placeholder="+1-809-555-0100" {...field} data-testid="input-edit-phone" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" placeholder="correo@email.com" {...field} data-testid="input-edit-email" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="company" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Empresa</FormLabel>
                      <FormControl><Input placeholder="Ej: Decolor S.A." {...field} data-testid="input-edit-company" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ciudad</FormLabel>
                      <FormControl><Input placeholder="Ej: Santo Domingo" {...field} data-testid="input-edit-city" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dirección</FormLabel>
                      <FormControl><Input placeholder="Calle, número, sector" {...field} data-testid="input-edit-address" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="birthday" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cumpleaños</FormLabel>
                      <FormControl><Input type="date" {...field} data-testid="input-edit-birthday" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="tag" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Etiqueta</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-edit-tag"><SelectValue placeholder="Seleccionar etiqueta..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {tagOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl><Textarea placeholder="Observaciones sobre el contacto..." rows={3} {...field} data-testid="textarea-edit-notes" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="pt-2 border-t border-card-border/50">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-3 flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Perfil comercial</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField control={form.control} name="buyerStatus" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estado del comprador</FormLabel>
                        <FormControl><Input placeholder="Ej: prospecto, comprador, recurrente" {...field} data-testid="input-edit-buyer-status" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="interests" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Intereses (separados por coma)</FormLabel>
                        <FormControl><Input placeholder="Ej: pintura interior, impermeabilizante" {...field} data-testid="input-edit-interests" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="purchaseProfile" render={({ field }) => (
                    <FormItem className="mt-3">
                      <FormLabel>Perfil de compra</FormLabel>
                      <FormControl><Textarea placeholder="Ej: Compra pintura para proyectos residenciales, presupuesto medio." rows={2} {...field} data-testid="textarea-edit-purchase-profile" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="outline" className="gap-2" onClick={() => { setEditing(false); form.reset(); }}>
                    <X className="w-4 h-4" /> Cancelar
                  </Button>
                  <Button type="submit" className="gap-2" disabled={updateContact.isPending} data-testid="button-save-contact">
                    <Save className="w-4 h-4" /> {updateContact.isPending ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        ) : (
          /* Detail info */
          <div className="space-y-6">
            <ProfileCard contact={contact} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-card-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-2">Información</h2>
              <div className="divide-y divide-card-border/50">
                <InfoRow icon={Phone} label="Teléfono" value={contact.phone} />
                <InfoRow icon={Mail} label="Email" value={contact.email} />
                <InfoRow icon={Building2} label="Empresa" value={contact.company} />
                <InfoRow icon={MapPin} label="Dirección" value={[contact.address, contact.city].filter(Boolean).join(", ")} />
                <InfoRow icon={Cake} label="Cumpleaños" value={contact.birthday ? fmtDate(contact.birthday) : null} />
                <InfoRow icon={Calendar} label="Cliente desde" value={fmtDate(contact.createdAt)} />
              </div>
              {contact.notes && (
                <div className="mt-4 pt-4 border-t border-card-border/50">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1">Notas</div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{contact.notes}</p>
                </div>
              )}
            </div>

            {/* Conversation history */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Historial de conversaciones</h2>
                <span className="text-xs text-muted-foreground">{conversations?.length ?? 0}</span>
              </div>
              {selectedConv !== null ? (
                <div className="flex flex-col">
                  <div className="px-4 py-2.5 border-b border-card-border flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8" onClick={() => setSelectedConv(null)}>
                      <ArrowLeft className="w-4 h-4" /> Volver
                    </Button>
                    <Button variant="ghost" size="sm" className="ml-auto text-primary h-8" onClick={() => setLocation("/inbox")}>
                      Abrir en Inbox
                    </Button>
                  </div>
                  {(() => {
                    const c = conversations?.find((x) => x.id === selectedConv);
                    return c?.contextSummary ? (
                      <div className="px-4 py-2 bg-primary/5 border-b border-card-border text-[11px] text-muted-foreground flex items-start gap-1.5" data-testid="context-summary">
                        <Sparkles className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                        <span><span className="font-medium text-foreground">Contexto IA:</span> {c.contextSummary}</span>
                      </div>
                    ) : null;
                  })()}
                  <ConversationThread conversationId={selectedConv} />
                </div>
              ) : (
                <div className="divide-y divide-card-border/50 max-h-[460px] overflow-y-auto">
                  {(conversations ?? []).map((conv) => {
                    const Icon = CHANNEL_ICONS[conv.channel];
                    return (
                      <button
                        key={conv.id}
                        onClick={() => setSelectedConv(conv.id)}
                        className="w-full text-left px-5 py-3.5 hover:bg-muted/20 transition-colors flex items-start gap-3"
                        data-testid={`conversation-item-${conv.id}`}
                      >
                        {Icon && <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${CHANNEL_COLORS[conv.channel] ?? ""}`} />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground capitalize">{conv.channel}</span>
                            <span className="text-[10px] text-muted-foreground">{fmtDate(conv.updatedAt)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground truncate mt-0.5">{conv.lastMessage ?? "Sin mensajes"}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground/70 flex-shrink-0 mt-0.5">{STATUS_LABELS[conv.status] ?? conv.status}</span>
                      </button>
                    );
                  })}
                  {(conversations ?? []).length === 0 && (
                    <div className="px-5 py-12 text-center">
                      <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">Sin conversaciones registradas</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
            {modules.email && <EmailThreadsCard contact={contact} />}
          </div>
        )}
        <MergeContactDialog contact={contact} open={mergeOpen} onOpenChange={setMergeOpen} />
      </div>
    </Layout>
  );
}
