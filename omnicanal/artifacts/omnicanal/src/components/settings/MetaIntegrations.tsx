import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetIntegrationSettings,
  useUpdateIntegrationSettings,
  useTestIntegration,
  getGetIntegrationSettingsQueryKey,
  type IntegrationSettings,
  type IntegrationSettingsInput,
} from "@workspace/api-client-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import {
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  KeyRound,
  Webhook,
  ShieldCheck,
  Plug,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { WhatsappNumbers } from "./WhatsappNumbers";
import { withBase } from "@/lib/base-path";

type Channel = "whatsapp" | "facebook" | "instagram";

type FormState = {
  metaAppId: string;
  metaAppSecret: string;
  webhookVerifyToken: string;
  whatsappEnabled: boolean;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  whatsappDisplayNumber: string;
  whatsappAccessToken: string;
  facebookEnabled: boolean;
  facebookPageId: string;
  facebookPageAccessToken: string;
  instagramEnabled: boolean;
  instagramBusinessAccountId: string;
  instagramAccessToken: string;
  instagramAppSecret: string;
};

const EMPTY: FormState = {
  metaAppId: "",
  metaAppSecret: "",
  webhookVerifyToken: "",
  whatsappEnabled: false,
  whatsappPhoneNumberId: "",
  whatsappBusinessAccountId: "",
  whatsappDisplayNumber: "",
  whatsappAccessToken: "",
  facebookEnabled: false,
  facebookPageId: "",
  facebookPageAccessToken: "",
  instagramEnabled: false,
  instagramBusinessAccountId: "",
  instagramAccessToken: "",
  instagramAppSecret: "",
};

// Never round-trip to the server: the API only ever returns a masked preview, so
// an empty input means "keep what is stored", not "clear it".
const SECRET_KEYS = new Set<keyof FormState>([
  "metaAppSecret",
  "whatsappAccessToken",
  "facebookPageAccessToken",
  "instagramAccessToken",
  "instagramAppSecret",
]);

function fromServer(s: IntegrationSettings): FormState {
  return {
    ...EMPTY,
    metaAppId: s.metaAppId ?? "",
    webhookVerifyToken: s.webhookVerifyToken ?? "",
    whatsappEnabled: s.whatsappEnabled,
    whatsappPhoneNumberId: s.whatsappPhoneNumberId ?? "",
    whatsappBusinessAccountId: s.whatsappBusinessAccountId ?? "",
    whatsappDisplayNumber: s.whatsappDisplayNumber ?? "",
    facebookEnabled: s.facebookEnabled,
    facebookPageId: s.facebookPageId ?? "",
    instagramEnabled: s.instagramEnabled,
    instagramBusinessAccountId: s.instagramBusinessAccountId ?? "",
  };
}

// ── Small field helpers ───────────────────────────────────────────────────────
function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground/70">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  isSet,
  preview,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isSet: boolean;
  preview?: string | null;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-foreground/70">{label}</Label>
        {isSet ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
            <CheckCircle2 className="w-3 h-3" /> Configurado {preview ? `· ${preview}` : ""}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">Sin configurar</span>
        )}
      </div>
      <Input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isSet ? "•••••••• (déjalo en blanco para conservar)" : "Pega el token aquí"}
        className="text-sm font-mono"
        autoComplete="new-password"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SaveButton({
  id,
  label,
  keys,
  saving,
  onSave,
}: {
  id: string;
  label: string;
  keys: Array<keyof FormState>;
  saving: string | null;
  onSave: (id: string, label: string, keys: Array<keyof FormState>) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => onSave(id, label, keys)}
      disabled={saving !== null}
      data-testid={`button-save-${id}`}
    >
      {saving === id ? (
        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
      ) : (
        <Save className="w-3.5 h-3.5 mr-2" />
      )}
      Guardar
    </Button>
  );
}

type TestState = { loading: boolean; ok?: boolean; message?: string };

export default function MetaIntegrations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetIntegrationSettings();
  const update = useUpdateIntegrationSettings();
  const test = useTestIntegration();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [tests, setTests] = useState<Record<Channel, TestState>>({
    whatsapp: { loading: false },
    facebook: { loading: false },
    instagram: { loading: false },
  });
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // Hydrate the draft from the server ONCE. Re-running this on every `data`
  // change would wipe whatever the user has typed — and pasting a token means
  // leaving the window to copy it from Meta, which is exactly what triggers
  // react-query's refetch-on-focus. The masked "Configurado" badges read from
  // `data` directly, so they still refresh after each save.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!data || hydrated.current) return;
    hydrated.current = true;
    setForm(fromServer(data));
  }, [data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const callbackUrl =
    typeof window !== "undefined" ? `${window.location.origin}${withBase("/api/webhooks/meta")}` : withBase("/api/webhooks/meta");

  // Saves one card at a time. Sending only that card's fields means a token
  // pasted into the wrong channel can never be written by a save meant for
  // another one, and "did my token save?" is answerable per channel.
  async function saveGroup(id: string, label: string, keys: Array<keyof FormState>) {
    const payload: Record<string, string | boolean> = {};
    for (const key of keys) {
      const value = form[key];
      if (typeof value === "boolean") {
        payload[key] = value;
      } else if (SECRET_KEYS.has(key)) {
        // Trim: a token copied from the Meta panel often carries a trailing
        // newline, which Meta then rejects as an invalid token.
        const trimmed = value.trim();
        if (trimmed) payload[key] = trimmed;
      } else {
        payload[key] = value;
      }
    }

    setSaving(id);
    try {
      await update.mutateAsync({ data: payload as IntegrationSettingsInput });
      await queryClient.invalidateQueries({ queryKey: getGetIntegrationSettingsQueryKey() });
      // Clear only this card's secret inputs; the masked badge now reflects them.
      setForm((f) => {
        const next = { ...f };
        for (const key of keys) {
          if (SECRET_KEYS.has(key)) (next[key] as string) = "";
        }
        return next;
      });
      toast({ title: `${label} guardado`, description: "Las credenciales fueron actualizadas." });
    } catch (err) {
      toast({
        title: `No se pudo guardar ${label}`,
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleTest(channel: Channel) {
    setTests((t) => ({ ...t, [channel]: { loading: true } }));
    try {
      const result = await test.mutateAsync({ data: { channel } });
      setTests((t) => ({ ...t, [channel]: { loading: false, ok: result.ok, message: result.message } }));
    } catch (err) {
      setTests((t) => ({
        ...t,
        [channel]: { loading: false, ok: false, message: err instanceof Error ? err.message : "Error" },
      }));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const channelCards: Array<{
    id: Channel;
    name: string;
    icon: typeof SiWhatsapp;
    color: string;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    keys: Array<keyof FormState>;
    fields: React.ReactNode;
  }> = [
    {
      id: "whatsapp",
      name: "WhatsApp Business (Cloud API)",
      icon: SiWhatsapp,
      color: "#25D366",
      enabled: form.whatsappEnabled,
      onToggle: (v) => set("whatsappEnabled", v),
      keys: [
        "whatsappEnabled",
        "whatsappPhoneNumberId",
        "whatsappBusinessAccountId",
        "whatsappDisplayNumber",
        "whatsappAccessToken",
      ],
      fields: (
        <>
          <TextField label="Phone Number ID" value={form.whatsappPhoneNumberId} onChange={(v) => set("whatsappPhoneNumberId", v)} placeholder="123456789012345" />
          <TextField label="WhatsApp Business Account ID (WABA)" value={form.whatsappBusinessAccountId} onChange={(v) => set("whatsappBusinessAccountId", v)} placeholder="987654321098765" />
          <TextField label="Número visible" value={form.whatsappDisplayNumber} onChange={(v) => set("whatsappDisplayNumber", v)} placeholder="+1 809 555 0100" />
          <SecretField label="Access Token (permanente)" value={form.whatsappAccessToken} onChange={(v) => set("whatsappAccessToken", v)} isSet={!!data?.whatsappAccessTokenSet} preview={data?.whatsappAccessTokenPreview} />
        </>
      ),
    },
    {
      id: "facebook",
      name: "Facebook Messenger",
      icon: SiFacebook,
      color: "#1877F2",
      enabled: form.facebookEnabled,
      onToggle: (v) => set("facebookEnabled", v),
      keys: ["facebookEnabled", "facebookPageId", "facebookPageAccessToken"],
      fields: (
        <>
          <TextField label="Page ID" value={form.facebookPageId} onChange={(v) => set("facebookPageId", v)} placeholder="102938475610293" />
          <SecretField label="Page Access Token" value={form.facebookPageAccessToken} onChange={(v) => set("facebookPageAccessToken", v)} isSet={!!data?.facebookPageAccessTokenSet} preview={data?.facebookPageAccessTokenPreview} />
        </>
      ),
    },
    {
      id: "instagram",
      name: "Instagram",
      icon: SiInstagram,
      color: "#E1306C",
      enabled: form.instagramEnabled,
      onToggle: (v) => set("instagramEnabled", v),
      keys: ["instagramEnabled", "instagramBusinessAccountId", "instagramAccessToken", "instagramAppSecret"],
      fields: (
        <>
          <TextField label="Instagram Business Account ID" value={form.instagramBusinessAccountId} onChange={(v) => set("instagramBusinessAccountId", v)} placeholder="17841400000000000" hint="No es el Page ID de Facebook. Empieza con 1784…: con un token de inicio de sesión con Instagram (IGAA…) es el número que sale bajo la cuenta; con un token de página, GET /me/accounts?fields=name,instagram_business_account" />
          <SecretField label="Access Token" value={form.instagramAccessToken} onChange={(v) => set("instagramAccessToken", v)} isSet={!!data?.instagramAccessTokenSet} preview={data?.instagramAccessTokenPreview} />
          <SecretField label="App Secret de Instagram" value={form.instagramAppSecret} onChange={(v) => set("instagramAppSecret", v)} isSet={!!data?.instagramAppSecretSet} preview={data?.instagramAppSecretPreview} hint="Solo con token de inicio de sesión con Instagram (IGAA…): Meta firma los mensajes de Instagram con esta clave y sin ella no entra ninguno. Está en developers.facebook.com → tu app → Instagram → Configuración de la API con inicio de sesión de Instagram → «Clave secreta de la app de Instagram». No es el App Secret de la app de Meta." />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plug className="w-4 h-4 text-primary" /> Conexión con Meta
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configura las credenciales oficiales para conectar WhatsApp, Facebook e Instagram en tiempo real.
          Cada sección se guarda por separado.
        </p>
      </div>

      {/* Meta App (shared) */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Aplicación de Meta</h3>
            <p className="text-[11px] text-muted-foreground">Credenciales compartidas por los tres canales</p>
          </div>
          <SaveButton
            id="meta-app"
            label="Aplicación de Meta"
            keys={["metaAppId", "metaAppSecret", "webhookVerifyToken"]}
            saving={saving}
            onSave={saveGroup}
          />
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="App ID" value={form.metaAppId} onChange={(v) => set("metaAppId", v)} placeholder="1234567890123456" />
          <SecretField label="App Secret" value={form.metaAppSecret} onChange={(v) => set("metaAppSecret", v)} isSet={!!data?.metaAppSecretSet} preview={data?.metaAppSecretPreview} />
          <TextField label="Webhook Verify Token" value={form.webhookVerifyToken} onChange={(v) => set("webhookVerifyToken", v)} placeholder="un-token-secreto-que-tu-eliges" hint="Lo defines tú y lo pegas igual en el panel de Meta al suscribir el webhook." />
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70 flex items-center gap-1.5"><Webhook className="w-3.5 h-3.5" /> URL de Callback (webhook)</Label>
            <div className="flex gap-2">
              <Input readOnly value={callbackUrl} className="text-sm font-mono bg-muted/40" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard?.writeText(callbackUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Pega esta URL y tu Verify Token al suscribir el webhook en Meta. El procesamiento de mensajes entrantes ya está activo.</p>
          </div>
        </div>
      </div>

      {/* Channel cards */}
      {channelCards.map((ch) => {
        const t = tests[ch.id];
        return (
          <div key={ch.id} className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid={`integration-card-${ch.id}`}>
            <div className="px-5 py-4 border-b border-card-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center">
                <ch.icon className="w-4.5 h-4.5" style={{ color: ch.color }} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">{ch.name}</h3>
                <p className="text-[11px] text-muted-foreground">{ch.enabled ? "Canal habilitado" : "Canal deshabilitado"}</p>
              </div>
              <Switch checked={ch.enabled} onCheckedChange={ch.onToggle} data-testid={`toggle-${ch.id}`} />
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{ch.fields}</div>
              <div className="flex items-start gap-3 pt-1">
                <SaveButton
                  id={ch.id}
                  label={ch.name}
                  keys={ch.keys}
                  saving={saving}
                  onSave={saveGroup}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(ch.id)}
                  disabled={t.loading}
                  data-testid={`button-test-${ch.id}`}
                >
                  {t.loading ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-2" />}
                  Probar conexión
                </Button>
                {t.message && (
                  <span className={`inline-flex items-start gap-1.5 text-xs ${t.ok ? "text-green-400" : "text-destructive"}`}>
                    {t.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                    {t.message}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Las pruebas usan la configuración ya guardada. Guarda esta sección antes de probar.</p>
            </div>
          </div>
        );
      })}

      {/* Los números de WhatsApp. Va después de las tarjetas de canal porque
          depende de ellas: el descubrimiento usa el WABA y el token que se
          guardan arriba. */}
      {form.whatsappEnabled && <WhatsappNumbers />}

      {/* Compliance note */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground">
          Las credenciales se almacenan en tu base de datos y nunca se devuelven al navegador una vez guardadas (solo se muestra una vista enmascarada). Usa tokens de sistema permanentes de la API Oficial de Meta.
        </p>
      </div>
    </div>
  );
}
