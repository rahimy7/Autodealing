import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGmailSettings,
  useUpdateGmailSettings,
  useConnectGmail,
  useDisconnectGmail,
  useSyncGmailNow,
  useImportGmailInbox,
  getGetGmailSettingsQueryKey,
  type GmailSettingsInput,
} from "@workspace/api-client-react";
import { SiGmail } from "react-icons/si";
import {
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  KeyRound,
  Link2,
  Unplug,
  RefreshCw,
  DownloadCloud,
  PenLine,
  ListChecks,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { withBase } from "@/lib/base-path";

const CALLBACK_PATH = "/api/gmail/oauth/callback";

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground/70">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="text-sm font-mono bg-muted/40" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function GmailIntegration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Mientras la importación completa corre en el servidor no hay otra forma de
  // saber cuándo termina que preguntar: se acelera el sondeo mientras
  // `importingInbox` esté en `true` y vuelve al ritmo normal en cuanto termina.
  const { data, isLoading } = useGetGmailSettings({
    query: {
      queryKey: getGetGmailSettingsQueryKey(),
      refetchInterval: (query) => (query.state.data?.importingInbox ? 4000 : false),
    },
  });
  const update = useUpdateGmailSettings();
  const connect = useConnectGmail();
  const disconnect = useDisconnectGmail();
  const sync = useSyncGmailNow();
  const importInbox = useImportGmailInbox();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fromName, setFromName] = useState("");
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState<"credentials" | "preferences" | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Se hidrata una sola vez, como en la conexión de Meta: copiar el Client Secret
  // obliga a salir a Google Cloud, y el refetch al volver borraría lo escrito.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!data || hydrated.current) return;
    hydrated.current = true;
    setClientId(data.clientId ?? "");
    setFromName(data.fromName ?? "");
    setSignature(data.signature ?? "");
  }, [data]);

  // Google devuelve el navegador aquí con ?gmail=connected|error. Es una carga de
  // la aplicación desde cero, así que el resultado va en la tarjeta y no en un
  // toast: uno lanzado durante el primer montaje se pierde antes de que el
  // contenedor de avisos empiece a escuchar.
  const [oauthOutcome, setOauthOutcome] = useState<{ ok: boolean; text: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("gmail");
    if (!outcome) return null;
    return outcome === "connected"
      ? { ok: true, text: "Cuenta conectada. Importando los correos del último mes…" }
      : { ok: false, text: `No se pudo conectar Gmail. ${params.get("reason") ?? ""}`.trim() };
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("gmail")) return;
    params.delete("gmail");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    void queryClient.invalidateQueries({ queryKey: getGetGmailSettingsQueryKey() });
  }, [queryClient]);

  const redirectUri = `${window.location.origin}${withBase(CALLBACK_PATH)}`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetGmailSettingsQueryKey() });

  async function save(section: "credentials" | "preferences", payload: GmailSettingsInput) {
    setSaving(section);
    try {
      await update.mutateAsync({ data: payload });
      await refresh();
      if (section === "credentials") setClientSecret("");
      toast({ title: section === "credentials" ? "Credenciales de Google guardadas" : "Preferencias guardadas" });
    } catch (err) {
      toast({
        title: "No se pudo guardar",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  }

  async function handleConnect() {
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const { url } = await connect.mutateAsync({ data: { redirectUri, returnUrl } });
      window.location.href = url;
    } catch (err) {
      toast({
        title: "No se pudo iniciar la conexión",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("¿Desconectar la cuenta de Gmail? Los correos ya importados se conservan.")) return;
    await disconnect.mutateAsync();
    await refresh();
    toast({ title: "Gmail desconectado" });
  }

  async function handleSync() {
    setSyncMessage(null);
    try {
      const result = await sync.mutateAsync();
      setSyncMessage({ ok: result.ok, text: result.message ?? "" });
      await refresh();
    } catch (err) {
      setSyncMessage({ ok: false, text: err instanceof Error ? err.message : "Error" });
    }
  }

  async function handleImportInbox() {
    setImportMessage(null);
    try {
      const result = await importInbox.mutateAsync();
      setImportMessage({ ok: result.ok, text: result.message });
      // El servidor ya marca `importingInbox`; este refresh es lo que lo trae al
      // instante en vez de esperar al primer sondeo automático.
      await refresh();
    } catch (err) {
      setImportMessage({ ok: false, text: err instanceof Error ? err.message : "Error" });
    }
  }

  async function handleToggle(enabled: boolean) {
    await update.mutateAsync({ data: { enabled } });
    await refresh();
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const canConnect = Boolean(data.clientId && data.clientSecretSet);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <SiGmail className="w-4 h-4 text-[#EA4335]" /> Correo de Gmail
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Los correos de los clientes entran a la sección Correo, la IA prepara la respuesta y el cliente queda en la
          misma ficha que su WhatsApp.
        </p>
      </div>

      {/* Estado de la conexión */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid="gmail-connection-card">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center">
            <SiGmail className="w-4.5 h-4.5 text-[#EA4335]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Cuenta conectada</h3>
            {data.connected ? (
              <p className="text-[11px] text-green-400 flex items-center gap-1 truncate">
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> {data.emailAddress ?? "Conectada"}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Sin cuenta conectada</p>
            )}
          </div>
          {data.connected && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{data.enabled ? "Sincronizando" : "En pausa"}</span>
              <Switch checked={data.enabled} onCheckedChange={handleToggle} data-testid="toggle-gmail" />
            </div>
          )}
        </div>
        <div className="p-5 space-y-4">
          {oauthOutcome && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
                oauthOutcome.ok ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
              data-testid="gmail-oauth-outcome"
            >
              {oauthOutcome.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
              <span className="flex-1">{oauthOutcome.text}</span>
              <button type="button" className="opacity-70 hover:opacity-100" onClick={() => setOauthOutcome(null)} aria-label="Cerrar">
                ×
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              onClick={handleConnect}
              disabled={!canConnect || connect.isPending}
              data-testid="button-gmail-connect"
            >
              {connect.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-2" />}
              {data.connected ? "Reconectar con Google" : "Conectar con Google"}
            </Button>
            {data.connected && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={handleSync} disabled={sync.isPending || !data.enabled}>
                  {sync.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
                  Sincronizar ahora
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleImportInbox}
                  disabled={importInbox.isPending || data.importingInbox || !data.enabled}
                  title="Trae los correos que ya están en la bandeja, no solo los nuevos desde que se conectó"
                  data-testid="button-gmail-import-inbox"
                >
                  {importInbox.isPending || data.importingInbox ? (
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  ) : (
                    <DownloadCloud className="w-3.5 h-3.5 mr-2" />
                  )}
                  {data.importingInbox ? "Importando…" : "Importar buzón completo"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnect.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  <Unplug className="w-3.5 h-3.5 mr-2" /> Desconectar
                </Button>
              </>
            )}
            {syncMessage && (
              <span className={`inline-flex items-center gap-1.5 text-xs ${syncMessage.ok ? "text-green-400" : "text-destructive"}`}>
                {syncMessage.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {syncMessage.text}
              </span>
            )}
          </div>
          {data.importingInbox && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              Trayendo el buzón completo — puede tardar varios minutos. Los correos van apareciendo en la bandeja de Correo mientras avanza.
            </p>
          )}
          {importMessage && !data.importingInbox && (
            <span className={`flex items-center gap-1.5 text-xs ${importMessage.ok ? "text-green-400" : "text-destructive"}`}>
              {importMessage.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {importMessage.text}
            </span>
          )}
          {!canConnect && (
            <p className="text-[11px] text-muted-foreground">
              Guarda primero el Client ID y el Client Secret de Google (abajo) para poder conectar la cuenta.
            </p>
          )}
          {data.connected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Última sincronización</div>
                <div className="text-foreground">{fmtDateTime(data.lastSyncAt)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Importación inicial</div>
                <div className="text-foreground">{data.initialImportDone ? "Completada" : "Pendiente"}</div>
              </div>
            </div>
          )}
          {data.lastError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {data.lastError}
            </div>
          )}
        </div>
      </div>

      {/* Credenciales de Google Cloud */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Cliente OAuth de Google Cloud</h3>
            <p className="text-[11px] text-muted-foreground">Los datos del cliente OAuth tipo "Aplicación web"</p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={saving !== null}
            onClick={() =>
              save("credentials", {
                clientId: clientId.trim(),
                ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
              })
            }
            data-testid="button-save-gmail-credentials"
          >
            {saving === "credentials" ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            Guardar
          </Button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70">Client ID</Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              className="text-sm font-mono"
              data-testid="input-gmail-client-id"
            />
            <p className="text-[10px] text-muted-foreground">Cambiarlo obliga a reconectar la cuenta.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-foreground/70">Client Secret</Label>
              {data.clientSecretSet ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
                  <CheckCircle2 className="w-3 h-3" /> Configurado {data.clientSecretPreview ? `· ${data.clientSecretPreview}` : ""}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">Sin configurar</span>
              )}
            </div>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={data.clientSecretSet ? "•••••••• (déjalo en blanco para conservar)" : "GOCSPX-…"}
              className="text-sm font-mono"
              autoComplete="new-password"
              data-testid="input-gmail-client-secret"
            />
          </div>
          <div className="sm:col-span-2">
            <CopyField
              label="URI de redireccionamiento autorizado"
              value={redirectUri}
              hint="Pégala tal cual en el cliente OAuth de Google Cloud, en «URIs de redireccionamiento autorizados»."
            />
          </div>
        </div>
      </div>

      {/* Cómo responde */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-2">
          <PenLine className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Respuestas</h3>
            <p className="text-[11px] text-muted-foreground">Cómo salen los correos que se envían desde el panel</p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={saving !== null}
            onClick={() => save("preferences", { fromName: fromName.trim(), signature })}
            data-testid="button-save-gmail-preferences"
          >
            {saving === "preferences" ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            Guardar
          </Button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground/70">Nombre del remitente</Label>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Decolor — Atención al cliente"
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Lo que el cliente ve como remitente. Vacío usa el de la cuenta de Google.</p>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border p-3">
              <div>
                <Label className="text-xs font-medium text-foreground">Enviar sin revisión cuando la intención es segura</Label>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Solo con las etiquetas marcadas como «segura para respuesta automática». Apagado, cada respuesta de la
                  IA queda como borrador para aprobar.
                </p>
              </div>
              <Switch
                checked={data.autoReply}
                onCheckedChange={async (autoReply) => {
                  await update.mutateAsync({ data: { autoReply } });
                  await refresh();
                }}
                data-testid="toggle-gmail-autoreply"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70">Firma</Label>
            <Textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              rows={4}
              placeholder={"Equipo de Atención al Cliente\nDecolor · +1 809 555 0100\nwww.decolor.com"}
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">Se añade al final de cada respuesta, de la IA o de una persona.</p>
          </div>
        </div>
      </div>

      {/* Guía */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-primary" /> Cómo obtener los datos
        </h3>
        <ol className="list-decimal pl-5 space-y-2 text-xs text-muted-foreground">
          <li>
            En{" "}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
              Google Cloud Console <ExternalLink className="w-3 h-3" />
            </a>{" "}
            crea (o elige) un proyecto y activa la <span className="text-foreground">Gmail API</span> en «APIs y servicios → Biblioteca».
          </li>
          <li>
            En «Pantalla de consentimiento de OAuth» configura la app. Si la cuenta es de Google Workspace elige tipo{" "}
            <span className="text-foreground">Interno</span>; si es una @gmail.com, <span className="text-foreground">Externo</span> y agrega el
            permiso <code className="text-foreground">gmail.modify</code>.
          </li>
          <li>
            Si elegiste Externo, pulsa <span className="text-foreground">Publicar app</span>. Mientras siga en «Prueba», Google corta el acceso cada 7
            días. Al conectar verás un aviso de «app no verificada»: entra por «Configuración avanzada» y continúa.
          </li>
          <li>
            En «Credenciales → Crear credenciales → ID de cliente de OAuth» elige <span className="text-foreground">Aplicación web</span> y agrega la
            URI de redireccionamiento de arriba.
          </li>
          <li>Copia el Client ID y el Client Secret aquí, guarda y pulsa «Conectar con Google» con la cuenta del buzón que atiende a los clientes.</li>
          <li>
            Para que la IA redacte las respuestas, en <span className="text-foreground">Agentes</span> activa el canal «email» en un agente virtual (o
            deja sus canales vacíos para que atienda todos).
          </li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-card-border">
          Al conectar se trae automáticamente solo el último mes, como contexto. <span className="text-foreground">«Importar buzón completo»</span>{" "}
          trae lo que ya hay en la bandeja sin límite de fecha (hasta 1,000 correos por pasada; si hay más, un segundo clic sigue donde
          quedó). Los correos nuevos que lleguen después no necesitan ningún botón: el servidor revisa el buzón{" "}
          <span className="text-foreground">cada minuto por su cuenta</span>. Gmail no ofrece avisos instantáneos sin montar un tema de
          Pub/Sub en Google Cloud por cliente, así que se optó por esta consulta periódica en vez de esa integración.
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground">
          El Client Secret y el acceso de Google se guardan en tu base de datos y nunca vuelven al navegador. Solo se leen los correos de la bandeja
          principal: promociones, redes sociales, notificaciones y boletines no entran.
        </p>
      </div>
    </div>
  );
}
