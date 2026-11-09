import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Building2,
  CreditCard,
  Palette,
  ToggleLeft,
  ToggleRight,
  Save,
  Lock,
  Unlock,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  EyeOff,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MODULE_LABELS } from "@workspace/platform-config";
import { withBase } from "@/lib/base-path";

// ── tipos ─────────────────────────────────────────────────────────────────────

type SubscriptionStatus = "active" | "trial" | "suspended";

interface ModuleEntry {
  key: string;
  enabled: boolean;
}

interface TenantData {
  clientId: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPaidUntil: string | null;
  monthlyPrice: number;
  blockedManually: boolean;
  notes: string | null;
  updatedAt: string;
  modules: Record<string, boolean>;
  branding: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    productName?: string;
    tagline?: string;
  };
  allModules: ModuleEntry[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "platform_admin_token";

function getToken(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

function saveToken(t: string) {
  if (t) localStorage.setItem(STORAGE_KEY, t);
  else localStorage.removeItem(STORAGE_KEY);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(withBase(`/api${path}`), {
    ...init,
    headers: { "content-type": "application/json", "x-platform-token": token, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── sub-componentes ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const styles: Record<SubscriptionStatus, string> = {
    active: "bg-green-100 text-green-700",
    trial: "bg-blue-100 text-blue-700",
    suspended: "bg-red-100 text-red-700",
  };
  const icons: Record<SubscriptionStatus, typeof CheckCircle> = {
    active: CheckCircle,
    trial: Clock,
    suspended: XCircle,
  };
  const labels: Record<SubscriptionStatus, string> = {
    active: "Activa",
    trial: "Prueba",
    suspended: "Suspendida",
  };
  const Icon = icons[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", styles[status])}>
      <Icon className="w-3.5 h-3.5" />
      {labels[status]}
    </span>
  );
}

// ── página principal ──────────────────────────────────────────────────────────

export default function PlatformPortal() {
  const { toast } = useToast();
  const [token, setToken] = useState(getToken());
  const [showToken, setShowToken] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState<TenantData | null>(null);

  // Formularios locales
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [branding, setBranding] = useState<TenantData["branding"]>({});
  const [subscription, setSubscription] = useState({
    subscriptionStatus: "active" as SubscriptionStatus,
    subscriptionPaidUntil: "",
    monthlyPrice: 0,
    blockedManually: false,
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<TenantData>("/platform-admin/tenant");
      setTenant(data);
      // init form state
      const modMap: Record<string, boolean> = {};
      data.allModules.forEach((m) => { modMap[m.key] = m.enabled; });
      setModules(modMap);
      setBranding(data.branding ?? {});
      setSubscription({
        subscriptionStatus: data.subscriptionStatus,
        subscriptionPaidUntil: data.subscriptionPaidUntil
          ? new Date(data.subscriptionPaidUntil).toISOString().slice(0, 10)
          : "",
        monthlyPrice: data.monthlyPrice,
        blockedManually: data.blockedManually,
        notes: data.notes ?? "",
      });
      setAuthenticated(true);
    } catch (err) {
      toast({ title: "Token inválido o portal no habilitado", description: String(err), variant: "destructive" });
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleLogin = async () => {
    saveToken(token);
    await load();
  };

  useEffect(() => {
    if (getToken()) void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveModules = async () => {
    setSaving(true);
    try {
      const updated = await apiFetch<TenantData>("/platform-admin/tenant", {
        method: "PUT",
        body: JSON.stringify({ modules }),
      });
      setTenant(updated);
      toast({ title: "Módulos guardados" });
    } catch (err) {
      toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveBranding = async () => {
    setSaving(true);
    try {
      const updated = await apiFetch<TenantData>("/platform-admin/tenant", {
        method: "PUT",
        body: JSON.stringify({ branding }),
      });
      setTenant(updated);
      toast({ title: "Marca guardada" });
    } catch (err) {
      toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveSubscription = async () => {
    setSaving(true);
    try {
      const updated = await apiFetch<TenantData>("/platform-admin/tenant", {
        method: "PUT",
        body: JSON.stringify({
          subscriptionStatus: subscription.subscriptionStatus,
          subscriptionPaidUntil: subscription.subscriptionPaidUntil || null,
          monthlyPrice: subscription.monthlyPrice,
          blockedManually: subscription.blockedManually,
          notes: subscription.notes || null,
        }),
      });
      setTenant(updated);
      toast({ title: "Suscripción actualizada" });
    } catch (err) {
      toast({ title: "Error al guardar", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleBlock = async () => {
    const next = !subscription.blockedManually;
    setSaving(true);
    try {
      const updated = await apiFetch<TenantData>("/platform-admin/tenant", {
        method: "PUT",
        body: JSON.stringify({ blockedManually: next }),
      });
      setTenant(updated);
      setSubscription((s) => ({ ...s, blockedManually: next }));
      toast({ title: next ? "Servicio bloqueado" : "Servicio desbloqueado" });
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Login screen ─────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm bg-card border border-card-border rounded-2xl p-8 shadow-lg space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Portal de Plataforma</h1>
            <p className="text-sm text-muted-foreground mt-1">Ingresa el token de administrador de plataforma</p>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="PLATFORM_ADMIN_TOKEN"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button className="w-full gap-2" onClick={() => void handleLogin()} disabled={loading || !token}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Acceder
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Portal ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Portal de Plataforma</h1>
              <p className="text-sm text-muted-foreground">Gestión de tenant · {tenant?.clientId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tenant && <StatusBadge status={tenant.subscriptionStatus} />}
            {subscription.blockedManually && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                <Lock className="w-3.5 h-3.5" /> Bloqueado
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </Button>
          </div>
        </div>

        {/* Stats rápidas */}
        {tenant && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Cliente ID", value: tenant.clientId, icon: Building2, color: "text-primary bg-primary/10" },
              { label: "Precio mensual", value: `$${tenant.monthlyPrice}`, icon: CreditCard, color: "text-green-600 bg-green-100" },
              {
                label: "Pago hasta",
                value: tenant.subscriptionPaidUntil
                  ? new Date(tenant.subscriptionPaidUntil).toLocaleDateString("es-DO")
                  : "Sin fecha",
                icon: Clock,
                color: "text-amber-600 bg-amber-100",
              },
              {
                label: "Módulos activos",
                value: tenant.allModules.filter((m) => m.enabled).length + "/" + tenant.allModules.length,
                icon: ToggleRight,
                color: "text-blue-600 bg-blue-100",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", color.split(" ")[1])}>
                  <Icon className={cn("w-4 h-4", color.split(" ")[0])} />
                </div>
                <div className="text-sm font-bold text-foreground">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="subscription" className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto sm:inline-flex">
            <TabsTrigger value="subscription" className="gap-1.5"><CreditCard className="w-3.5 h-3.5" />Suscripción</TabsTrigger>
            <TabsTrigger value="modules" className="gap-1.5"><ToggleLeft className="w-3.5 h-3.5" />Módulos</TabsTrigger>
            <TabsTrigger value="branding" className="gap-1.5"><Palette className="w-3.5 h-3.5" />Marca</TabsTrigger>
          </TabsList>

          {/* ── SUSCRIPCIÓN ── */}
          <TabsContent value="subscription">
            <div className="bg-card border border-card-border rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="font-semibold text-foreground">Suscripción y acceso</h2>
                <p className="text-sm text-muted-foreground">Controla el estado del servicio, fechas de pago y bloqueo manual.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Estado</label>
                  <select
                    value={subscription.subscriptionStatus}
                    onChange={(e) => setSubscription((s) => ({ ...s, subscriptionStatus: e.target.value as SubscriptionStatus }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="active">Activa</option>
                    <option value="trial">Período de prueba</option>
                    <option value="suspended">Suspendida</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Precio mensual (USD)</label>
                  <Input
                    type="number"
                    min="0"
                    value={subscription.monthlyPrice}
                    onChange={(e) => setSubscription((s) => ({ ...s, monthlyPrice: Number(e.target.value) }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Pago vigente hasta</label>
                  <Input
                    type="date"
                    value={subscription.subscriptionPaidUntil}
                    onChange={(e) => setSubscription((s) => ({ ...s, subscriptionPaidUntil: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Si la fecha vence y el estado no es "prueba", el servicio se suspende automáticamente.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Notas internas</label>
                  <Input
                    placeholder="Contacto, factura, observaciones…"
                    value={subscription.notes}
                    onChange={(e) => setSubscription((s) => ({ ...s, notes: e.target.value }))}
                  />
                </div>
              </div>

              {/* Bloqueo manual */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-orange-200 bg-orange-50">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                    {subscription.blockedManually ? <Lock className="w-4 h-4 text-orange-600" /> : <Unlock className="w-4 h-4 text-green-600" />}
                    Bloqueo manual
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Bloquea el servicio inmediatamente, independientemente del estado de pago.
                  </div>
                </div>
                <Button
                  variant={subscription.blockedManually ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => void toggleBlock()}
                  disabled={saving}
                  className="gap-1.5 ml-4"
                >
                  {subscription.blockedManually ? <><Lock className="w-3.5 h-3.5" /> Bloqueado</> : <><Unlock className="w-3.5 h-3.5" /> Desbloquear</>}
                </Button>
              </div>

              <Button onClick={() => void saveSubscription()} disabled={saving} className="gap-2">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar suscripción
              </Button>
            </div>
          </TabsContent>

          {/* ── MÓDULOS ── */}
          <TabsContent value="modules">
            <div className="bg-card border border-card-border rounded-2xl p-6 space-y-5">
              <div className="space-y-1">
                <h2 className="font-semibold text-foreground">Módulos habilitados</h2>
                <p className="text-sm text-muted-foreground">Activa o desactiva funcionalidades para este tenant. Los cambios aplican en la siguiente recarga del cliente.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tenant?.allModules.map(({ key }) => (
                  <div key={key} className="flex items-center justify-between p-3 rounded-xl border border-card-border bg-muted/20">
                    <div className="space-y-0">
                      <div className="text-sm font-medium text-foreground">
                        {(MODULE_LABELS as Record<string, string>)[key] ?? key}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{key}</div>
                    </div>
                    <Switch
                      checked={modules[key] ?? false}
                      onCheckedChange={(v) => setModules((m) => ({ ...m, [key]: v }))}
                    />
                  </div>
                ))}
              </div>

              <Button onClick={() => void saveModules()} disabled={saving} className="gap-2">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar módulos
              </Button>
            </div>
          </TabsContent>

          {/* ── MARCA ── */}
          <TabsContent value="branding">
            <div className="bg-card border border-card-border rounded-2xl p-6 space-y-5">
              <div className="space-y-1">
                <h2 className="font-semibold text-foreground">Marca y apariencia</h2>
                <p className="text-sm text-muted-foreground">Personaliza el logo y la paleta de colores del tenant. Sobrescribe la configuración estática del servidor.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Nombre del producto</label>
                  <Input
                    placeholder="OmniAI"
                    value={branding.productName ?? ""}
                    onChange={(e) => setBranding((b) => ({ ...b, productName: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Eslogan / Tagline</label>
                  <Input
                    placeholder="Plataforma Omnicanal"
                    value={branding.tagline ?? ""}
                    onChange={(e) => setBranding((b) => ({ ...b, tagline: e.target.value }))}
                  />
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium text-foreground">URL del logo</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://cdn.ejemplo.com/logo.png"
                      value={branding.logoUrl ?? ""}
                      onChange={(e) => setBranding((b) => ({ ...b, logoUrl: e.target.value || null }))}
                    />
                    {branding.logoUrl && (
                      <img
                        src={withBase(branding.logoUrl)}
                        alt="preview"
                        className="w-9 h-9 rounded-lg border object-contain bg-white flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                  </div>
                </div>

                {(["primaryColor", "secondaryColor", "accentColor"] as const).map((field) => {
                  const labels: Record<string, string> = {
                    primaryColor: "Color primario (botones, activo)",
                    secondaryColor: "Color secundario (sidebar)",
                    accentColor: "Color de acento (gráficos)",
                  };
                  const val = branding[field] ?? "";
                  return (
                    <div key={field} className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">{labels[field]}</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={val || "#6366f1"}
                          onChange={(e) => setBranding((b) => ({ ...b, [field]: e.target.value }))}
                          className="w-9 h-9 rounded-lg border cursor-pointer p-0.5 bg-white"
                        />
                        <Input
                          placeholder="#6366f1"
                          value={val}
                          onChange={(e) => setBranding((b) => ({ ...b, [field]: e.target.value || null }))}
                          className="font-mono"
                        />
                        {val && (
                          <button
                            type="button"
                            onClick={() => setBranding((b) => ({ ...b, [field]: null }))}
                            className="text-muted-foreground hover:text-destructive text-xs px-2"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button onClick={() => void saveBranding()} disabled={saving} className="gap-2">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar marca
              </Button>
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
