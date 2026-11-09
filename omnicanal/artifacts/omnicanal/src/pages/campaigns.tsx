import { useContactTags } from "@/hooks/use-contact-tags";
import { CampaignReport } from "@/components/campaign-report";
import { useMemo, useState } from "react";
import {
  useListCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useSendCampaign,
  getListCampaignsQueryKey,
  useListCampaignTemplates,
  useListWhatsappNumbers,
  getListCampaignTemplatesQueryKey,
  useListContacts,
  getListContactsQueryKey,
  customFetch,
  type MarketingTemplate,
  type MarketingTemplateComponentsItem,
  type CampaignPayload,
  type CampaignInput,
  type ContactTag,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Megaphone,
  Send,
  Trash2,
  Calendar,
  Users,
  BarChart2,
  Clock,
  AlertTriangle,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  MapPin,
  Upload,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ChannelId = "whatsapp" | "instagram" | "facebook";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted/50 text-muted-foreground",
  scheduled: "bg-blue-500/15 text-blue-400",
  sending: "bg-yellow-500/15 text-yellow-400",
  sent: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  sent: "Enviada",
  failed: "Fallida",
};

const TYPE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  utility: "Utilidad",
  authentication: "Autenticación",
};

const CHANNELS: { id: ChannelId; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: "whatsapp", label: "WhatsApp", icon: (p) => <SiWhatsapp {...p} />, color: "text-[#25D366]" },
  { id: "instagram", label: "Instagram", icon: (p) => <SiInstagram {...p} />, color: "text-[#E1306C]" },
  { id: "facebook", label: "Facebook", icon: (p) => <SiFacebook {...p} />, color: "text-[#1877F2]" },
];

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: (p) => <SiWhatsapp {...p} />,
  instagram: (p) => <SiInstagram {...p} />,
  facebook: (p) => <SiFacebook {...p} />,
};
const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
};


// ── WhatsApp template helpers ─────────────────────────────────────────────────
const comp = (t: MarketingTemplate | null, type: string): MarketingTemplateComponentsItem | undefined =>
  t?.components?.find((c) => (c.type ?? "").toUpperCase() === type);

function headerKind(format?: string | null): "image" | "video" | "document" | "location" | "text" | null {
  switch ((format ?? "").toUpperCase()) {
    case "IMAGE": return "image";
    case "VIDEO": return "video";
    case "DOCUMENT": return "document";
    case "LOCATION": return "location";
    case "TEXT": return "text";
    default: return null;
  }
}

function countBodyVars(text?: string | null): number {
  const matches = text?.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => parseInt(m.replace(/\D/g, ""), 10)));
}

function categoryToType(category?: string): CampaignInput["type"] {
  const c = (category ?? "").toUpperCase();
  if (c === "UTILITY") return "utility";
  if (c === "AUTHENTICATION") return "authentication";
  return "marketing";
}

// Uploads a broadcast asset (raw binary) via the API; returns the stored refs.
async function uploadBroadcastMedia(
  file: File,
  channel: ChannelId,
): Promise<{ path: string; url: string | null; whatsappMediaId: string | null; contentType: string }> {
  return customFetch(`/api/campaigns/media?channel=${channel}`, {
    method: "POST",
    body: file,
    headers: { "content-type": file.type || "application/octet-stream" },
    responseType: "json",
  });
}

type HeaderMedia = { type: "image" | "video" | "document"; mediaId?: string | null; url?: string | null };

export default function CampaignsPage() {
  const { labels: TAG_LABELS, options: tagOptions } = useContactTags();
  const [open, setOpen] = useState(false);
  const [reportCampaignId, setReportCampaignId] = useState<number | null>(null);
  const { data: campaigns, isLoading } = useListCampaigns();
  const createCampaign = useCreateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const sendCampaign = useSendCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Wizard state
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<ChannelId>("whatsapp");
  // Desde qué número sale la campaña. null = el principal, que es lo que hacían
  // todas antes de que hubiera varios.
  const [whatsappNumberId, setWhatsappNumberId] = useState<number | null>(null);
  const { data: whatsappNumbers } = useListWhatsappNumbers();
  const waNumbers = (whatsappNumbers?.numbers ?? []).filter((n) => n.isActive);
  const [campaignType, setCampaignType] = useState<CampaignInput["type"]>("marketing");
  const [selectedTemplate, setSelectedTemplate] = useState<MarketingTemplate | null>(null);
  const [variables, setVariables] = useState<string[]>([]);
  const [headerMedia, setHeaderMedia] = useState<HeaderMedia | null>(null);
  const [location, setLocation] = useState({ latitude: "", longitude: "", name: "", address: "" });
  const [message, setMessage] = useState("");
  const [freeMedia, setFreeMedia] = useState<{ type: "image" | "video"; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sendWhen, setSendWhen] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });

  const resetWizard = () => {
    setStep(1);
    setName("");
    setChannel("whatsapp");
    setCampaignType("marketing");
    setSelectedTemplate(null);
    setVariables([]);
    setHeaderMedia(null);
    setLocation({ latitude: "", longitude: "", name: "", address: "" });
    setMessage("");
    setFreeMedia(null);
    setSearch("");
    setTagFilter("all");
    setSelectedIds(new Set());
    setSendWhen("now");
    setScheduledAt("");
  };

  const closeWizard = () => {
    setOpen(false);
    resetWizard();
  };

  // ── Templates (WhatsApp only) ──
  const {
    data: templates,
    isLoading: templatesLoading,
    error: templatesError,
  } = useListCampaignTemplates(
    { channel },
    { query: { enabled: open && channel === "whatsapp" && step === 2, queryKey: getListCampaignTemplatesQueryKey({ channel }) } },
  );

  // ── Contacts (recipient picker) ──
  const contactsParams = { search: search || undefined, tag: tagFilter !== "all" ? (tagFilter as ContactTag) : undefined };
  const { data: contacts } = useListContacts(contactsParams, {
    query: { enabled: open && step === 3, queryKey: getListContactsQueryKey(contactsParams) },
  });
  const eligibleContacts = useMemo(
    () =>
      (contacts ?? []).filter((c) => {
        const chans = c.channels ?? [];
        return channel === "whatsapp" ? chans.includes("whatsapp") || Boolean(c.phone) : chans.includes(channel);
      }),
    [contacts, channel],
  );
  const allEligibleSelected = eligibleContacts.length > 0 && eligibleContacts.every((c) => selectedIds.has(c.id));

  const headerComponent = comp(selectedTemplate, "HEADER");
  const headerType = headerKind(headerComponent?.format);
  const bodyText = comp(selectedTemplate, "BODY")?.text ?? "";
  const footerText = comp(selectedTemplate, "FOOTER")?.text ?? "";

  const pickTemplate = (t: MarketingTemplate) => {
    setSelectedTemplate(t);
    setCampaignType(categoryToType(t.category));
    setVariables(Array.from({ length: countBodyVars(comp(t, "BODY")?.text) }, () => ""));
    setHeaderMedia(null);
    setLocation({ latitude: "", longitude: "", name: "", address: "" });
  };

  const handleUpload = async (file: File, target: "header" | "free") => {
    setUploading(true);
    try {
      const r = await uploadBroadcastMedia(file, channel);
      if (target === "header") {
        const kind = file.type.startsWith("video") ? "video" : file.type.startsWith("image") ? "image" : "document";
        setHeaderMedia({ type: kind, mediaId: r.whatsappMediaId, url: r.url });
      } else {
        if (!r.url) throw new Error("Sin URL");
        setFreeMedia({ type: file.type.startsWith("video") ? "video" : "image", url: r.url });
      }
    } catch {
      toast({ title: "Error al subir el archivo", description: "Revisa el almacenamiento o las credenciales.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const toggleContact = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (eligibleContacts.every((c) => prev.has(c.id))) {
        const next = new Set(prev);
        eligibleContacts.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      eligibleContacts.forEach((c) => next.add(c.id));
      return next;
    });
  };

  // ── Step gating ──
  const canNext = (): boolean => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) {
      if (channel === "whatsapp") {
        if (!selectedTemplate) return false;
        if (variables.some((v) => !v.trim())) return false;
        if (headerType === "location") return Boolean(location.latitude && location.longitude);
        if (headerType === "image" || headerType === "video" || headerType === "document") return Boolean(headerMedia);
        return true;
      }
      return message.trim().length > 0 || Boolean(freeMedia);
    }
    if (step === 3) return selectedIds.size > 0;
    return true;
  };

  const buildPayload = (): CampaignPayload => {
    if (channel === "whatsapp") {
      const payload: CampaignPayload = { bodyText, variables };
      if (headerType === "location") {
        payload.header = {
          type: "location",
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          name: location.name,
          address: location.address,
        };
      } else if (headerMedia) {
        payload.header = headerMedia;
      }
      return payload;
    }
    const payload: CampaignPayload = { bodyText: message };
    if (freeMedia) payload.media = freeMedia;
    return payload;
  };

  const submitting = createCampaign.isPending || sendCampaign.isPending;

  const handleSubmit = () => {
    const isSchedule = sendWhen === "schedule" && scheduledAt;
    const data: CampaignInput = {
      name: name.trim(),
      channel,
      whatsappNumberId: channel === "whatsapp" ? whatsappNumberId : null,
      type: campaignType,
      mode: channel === "whatsapp" ? "template" : "freeform",
      message: channel === "whatsapp" ? bodyText || null : message,
      templateName: channel === "whatsapp" ? selectedTemplate?.name ?? null : null,
      templateLanguage: channel === "whatsapp" ? selectedTemplate?.language ?? null : null,
      payload: buildPayload(),
      recipientContactIds: Array.from(selectedIds),
      scheduledAt: isSchedule ? new Date(scheduledAt).toISOString() : null,
    };

    createCampaign.mutate(
      { data },
      {
        onSuccess: (created) => {
          invalidate();
          if (isSchedule) {
            toast({ title: "Campaña programada", description: `Se enviará el ${new Date(scheduledAt).toLocaleString("es-DO")}.` });
            closeWizard();
          } else {
            sendCampaign.mutate(
              { id: created.id },
              {
                onSuccess: () => {
                  invalidate();
                  toast({ title: "Envío iniciado", description: "La campaña se está enviando a los destinatarios." });
                },
                onError: () => toast({ title: "No se pudo iniciar el envío", variant: "destructive" }),
              },
            );
            closeWizard();
          }
        },
        onError: () => toast({ title: "No se pudo crear la campaña", variant: "destructive" }),
      },
    );
  };

  const handleSend = (id: number) => {
    sendCampaign.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Envío iniciado" }); } });
  };
  const handleDelete = (id: number) => {
    deleteCampaign.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Campaña eliminada" }); } });
  };

  const STEP_TITLES = ["Canal y nombre", "Contenido", "Destinatarios", "Envío"];

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Marketing</h1>
            <p className="text-sm text-muted-foreground">Envía mensajes de marketing por WhatsApp, Instagram y Facebook</p>
          </div>
          <Button onClick={() => { resetWizard(); setOpen(true); }} data-testid="button-new-campaign" className="gap-2">
            <Plus className="w-4 h-4" /> Nueva Campaña
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Campañas", value: campaigns?.length ?? 0, icon: Megaphone },
            { label: "Enviadas", value: campaigns?.filter((c) => c.status === "sent").length ?? 0, icon: Send },
            { label: "Destinatarios", value: campaigns?.reduce((s, c) => s + c.recipientCount, 0) ?? 0, icon: Users },
            { label: "Mensajes Enviados", value: campaigns?.reduce((s, c) => s + (c.sentCount ?? 0), 0) ?? 0, icon: BarChart2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Campaign list */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Todas las Campañas</h2>
            <span className="text-xs text-muted-foreground">{campaigns?.length ?? 0} campañas</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando campañas...</div>
          ) : (
            <div className="divide-y divide-card-border">
              {(campaigns ?? []).map((campaign) => {
                const Icon = CHANNEL_ICONS[campaign.channel];
                return (
                  <div key={campaign.id} className="px-5 py-4 hover:bg-muted/20 transition-colors flex items-center gap-4" data-testid={`campaign-row-${campaign.id}`}>
                    <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                      {Icon && <Icon className={`w-4 h-4 ${CHANNEL_COLORS[campaign.channel]}`} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground">{campaign.name}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS_STYLES[campaign.status]}`}>
                          {STATUS_LABELS[campaign.status]}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 px-1.5 py-0.5 rounded-md bg-muted/30">
                          {TYPE_LABELS[campaign.type]}
                        </span>
                        {campaign.templateName && (
                          <span className="text-[10px] text-muted-foreground/60 px-1.5 py-0.5 rounded-md bg-muted/30">
                            {campaign.templateName}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-md">{campaign.message || campaign.payload?.bodyText || "—"}</p>
                    </div>
                    <div className="flex items-center gap-5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5" title="Destinatarios">
                        <Users className="w-3.5 h-3.5" />
                        <span className="tabular-nums">{campaign.recipientCount.toLocaleString()}</span>
                      </div>
                      {(campaign.sentCount ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5 text-green-400" title="Enviados">
                          <Check className="w-3.5 h-3.5" />
                          <span className="tabular-nums">{campaign.sentCount}</span>
                        </div>
                      )}
                      {(campaign.failedCount ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5 text-red-400" title="Fallidos">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="tabular-nums">{campaign.failedCount}</span>
                        </div>
                      )}
                      {campaign.scheduledAt && campaign.status === "scheduled" && (
                        <div className="flex items-center gap-1.5 text-blue-400" title="Programada">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{new Date(campaign.scheduledAt).toLocaleString("es-DO")}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => setReportCampaignId(campaign.id)} data-testid={`button-report-campaign-${campaign.id}`}>
                        <BarChart2 className="w-3.5 h-3.5" /> Ver reporte
                      </Button>
                      {(campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "failed") && (
                        <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-8" onClick={() => handleSend(campaign.id)} data-testid={`button-send-campaign-${campaign.id}`}>
                          <Send className="w-3.5 h-3.5" /> Enviar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 h-8 w-8 p-0" onClick={() => handleDelete(campaign.id)} data-testid={`button-delete-campaign-${campaign.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {(campaigns ?? []).length === 0 && (
                <div className="p-12 text-center">
                  <Megaphone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No hay campañas aún</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Crea tu primera campaña de marketing</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Wizard */}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeWizard())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nueva Campaña · {STEP_TITLES[step - 1]}</DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 pb-2">
            {STEP_TITLES.map((t, i) => (
              <div key={t} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${i + 1 <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {i + 1 < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < STEP_TITLES.length - 1 && <div className={`flex-1 h-0.5 ${i + 1 < step ? "bg-primary" : "bg-muted"}`} />}
              </div>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
            {/* STEP 1 — channel + name */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nombre de la campaña</Label>
                  <Input placeholder="Ej: Promoción Navidad 2025" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-campaign-name" />
                </div>
                <div className="space-y-2">
                  <Label>Canal</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {CHANNELS.map(({ id, label, icon: Icon, color }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { setChannel(id); setSelectedTemplate(null); setSelectedIds(new Set()); }}
                        data-testid={`channel-${id}`}
                        className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${channel === id ? "border-primary bg-primary/10" : "border-card-border hover:bg-muted/30"}`}
                      >
                        <Icon className={`w-6 h-6 ${color}`} />
                        <span className="text-xs font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                  {channel !== "whatsapp" && (
                    <p className="text-xs text-muted-foreground/70">
                      Instagram y Facebook no usan plantillas de Meta: redactarás un mensaje libre. Sujeto a la ventana de 24h de Meta.
                    </p>
                  )}
                </div>
                {/* Desde qué número sale. Solo con más de uno: con uno solo no hay
                    nada que elegir y el envío usa el principal igual. */}
                {channel === "whatsapp" && waNumbers.length > 1 && (
                  <div className="space-y-2">
                    <Label>Enviar desde</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {waNumbers.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => setWhatsappNumberId(n.id)}
                          data-testid={`campaign-number-${n.id}`}
                          className={`text-left rounded-lg border p-3 transition-colors ${whatsappNumberId === n.id ? "border-primary bg-primary/10" : "border-card-border hover:bg-muted/30"}`}
                        >
                          <div className="text-xs font-medium">{n.label || n.displayNumber || n.phoneNumberId}</div>
                          <div className="text-[10px] text-muted-foreground">{n.displayNumber ?? n.phoneNumberId}</div>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground/70">
                      Los destinatarios verán este número como remitente. Si no eliges, sale por el principal.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2 — content */}
            {step === 2 && channel === "whatsapp" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Plantilla aprobada de Meta</Label>
                  {templatesLoading && <p className="text-sm text-muted-foreground">Cargando plantillas…</p>}
                  {templatesError && (
                    <p className="text-sm text-red-400">No se pudieron cargar las plantillas. Verifica las credenciales de WhatsApp en Configuración.</p>
                  )}
                  {!templatesLoading && !templatesError && (templates ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No hay plantillas aprobadas disponibles.</p>
                  )}
                  {!templatesLoading && (templates ?? []).length > 0 && (
                    <Select
                      value={selectedTemplate?.name ?? ""}
                      onValueChange={(v) => {
                        const t = (templates ?? []).find((x) => x.name === v);
                        if (t) pickTemplate(t);
                      }}
                    >
                      <SelectTrigger data-testid="select-template"><SelectValue placeholder="Selecciona una plantilla" /></SelectTrigger>
                      <SelectContent>
                        {(templates ?? []).map((t) => (
                          <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                            {t.name} · {t.language} · {t.category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selectedTemplate && (
                  <div className="space-y-4 rounded-lg border border-card-border p-4">
                    {/* Header */}
                    {headerType && headerType !== "text" && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5">
                          {headerType === "image" && <ImageIcon className="w-3.5 h-3.5" />}
                          {headerType === "video" && <VideoIcon className="w-3.5 h-3.5" />}
                          {headerType === "document" && <FileText className="w-3.5 h-3.5" />}
                          {headerType === "location" && <MapPin className="w-3.5 h-3.5" />}
                          Encabezado ({headerType})
                        </Label>
                        {headerType === "location" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder="Latitud" value={location.latitude} onChange={(e) => setLocation((l) => ({ ...l, latitude: e.target.value }))} />
                            <Input placeholder="Longitud" value={location.longitude} onChange={(e) => setLocation((l) => ({ ...l, longitude: e.target.value }))} />
                            <Input placeholder="Nombre del lugar" value={location.name} onChange={(e) => setLocation((l) => ({ ...l, name: e.target.value }))} />
                            <Input placeholder="Dirección" value={location.address} onChange={(e) => setLocation((l) => ({ ...l, address: e.target.value }))} />
                          </div>
                        ) : (
                          <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-card-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/30">
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            <span>{headerMedia ? "Archivo cargado ✓ (clic para reemplazar)" : `Subir ${headerType}`}</span>
                            <input
                              type="file"
                              className="hidden"
                              accept={headerType === "image" ? "image/*" : headerType === "video" ? "video/*" : undefined}
                              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "header")}
                            />
                          </label>
                        )}
                      </div>
                    )}

                    {/* Body preview + variables */}
                    {bodyText && (
                      <div className="space-y-1">
                        <Label>Cuerpo</Label>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap rounded-md bg-muted/30 p-3">{bodyText}</p>
                      </div>
                    )}
                    {variables.length > 0 && (
                      <div className="space-y-2">
                        <Label>Variables</Label>
                        {variables.map((v, i) => (
                          <Input
                            key={i}
                            placeholder={`Valor para {{${i + 1}}}`}
                            value={v}
                            onChange={(e) => setVariables((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                            data-testid={`template-var-${i}`}
                          />
                        ))}
                      </div>
                    )}
                    {footerText && <p className="text-xs text-muted-foreground/70">{footerText}</p>}
                  </div>
                )}
              </div>
            )}

            {step === 2 && channel !== "whatsapp" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Mensaje</Label>
                  <Textarea rows={5} placeholder="Escribe tu mensaje de marketing…" value={message} onChange={(e) => setMessage(e.target.value)} data-testid="textarea-message" />
                </div>
                <div className="space-y-2">
                  <Label>Imagen o video (opcional)</Label>
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-card-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/30 w-fit">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{freeMedia ? `${freeMedia.type} cargado ✓` : "Subir archivo"}</span>
                    <input type="file" className="hidden" accept="image/*,video/*" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], "free")} />
                  </label>
                </div>
              </div>
            )}

            {/* STEP 3 — recipients */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input placeholder="Buscar contacto…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" data-testid="input-contact-search" />
                  <Select value={tagFilter} onValueChange={setTagFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las etiquetas</SelectItem>
                      {tagOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={allEligibleSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all" />
                    Seleccionar todos ({eligibleContacts.length})
                  </label>
                  <span>{selectedIds.size} seleccionados</span>
                </div>
                <ScrollArea className="h-64 rounded-lg border border-card-border">
                  <div className="divide-y divide-card-border">
                    {eligibleContacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 cursor-pointer" data-testid={`recipient-${c.id}`}>
                        <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleContact(c.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.phone ?? c.email ?? "—"}</div>
                        </div>
                        {c.tag && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground">{TAG_LABELS[c.tag] ?? c.tag}</span>}
                      </label>
                    ))}
                    {eligibleContacts.length === 0 && (
                      <p className="p-6 text-center text-sm text-muted-foreground">No hay contactos elegibles para {channel} con estos filtros.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* STEP 4 — schedule/send */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-card-border p-4 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Campaña</span><span className="font-medium">{name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Canal</span><span className="font-medium capitalize">{channel}</span></div>
                  {channel === "whatsapp" && <div className="flex justify-between"><span className="text-muted-foreground">Plantilla</span><span className="font-medium">{selectedTemplate?.name}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Destinatarios</span><span className="font-medium">{selectedIds.size}</span></div>
                </div>
                <RadioGroup value={sendWhen} onValueChange={(v) => setSendWhen(v as "now" | "schedule")} className="space-y-2">
                  <label className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer">
                    <RadioGroupItem value="now" id="send-now" />
                    <div><div className="text-sm font-medium">Enviar ahora</div><div className="text-xs text-muted-foreground">El envío comienza inmediatamente.</div></div>
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-card-border p-3 cursor-pointer">
                    <RadioGroupItem value="schedule" id="send-schedule" />
                    <div className="flex-1"><div className="text-sm font-medium">Programar</div><div className="text-xs text-muted-foreground">Se enviará automáticamente en la fecha elegida.</div></div>
                  </label>
                </RadioGroup>
                {sendWhen === "schedule" && (
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    data-testid="input-scheduled-at"
                  />
                )}
              </div>
            )}
          </div>

          {/* Wizard footer */}
          <div className="flex items-center justify-between pt-2 border-t border-card-border">
            <Button variant="ghost" onClick={() => (step === 1 ? closeWizard() : setStep((s) => s - 1))} className="gap-1.5">
              <ChevronLeft className="w-4 h-4" /> {step === 1 ? "Cancelar" : "Atrás"}
            </Button>
            {step < 4 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="gap-1.5" data-testid="button-wizard-next">
                Siguiente <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting || (sendWhen === "schedule" && !scheduledAt)} className="gap-1.5" data-testid="button-wizard-submit">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sendWhen === "schedule" ? "Programar" : "Enviar ahora"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CampaignReport campaignId={reportCampaignId} onClose={() => setReportCampaignId(null)} />
    </Layout>
  );
}

