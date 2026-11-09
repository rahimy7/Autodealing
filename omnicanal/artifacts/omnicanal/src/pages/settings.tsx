import { useState } from "react";
import { CheckCircle, ExternalLink, Shield, Zap, MessageSquare, BarChart2, HelpCircle, Pencil } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import MetaIntegrations from "@/components/settings/MetaIntegrations";
import GmailIntegration from "@/components/settings/GmailIntegration";
import ExchangeRates from "@/components/settings/ExchangeRates";
import ShopifyIntegration from "@/components/settings/ShopifyIntegration";
import UspsIntegration from "@/components/settings/UspsIntegration";
import { useModules } from "@/lib/platform";
import { useGetPlan, useUpdatePlan, getGetPlanQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const channels = [
  { id: "whatsapp", name: "WhatsApp Business API", icon: SiWhatsapp, color: "#25D366", status: "connected", description: "API Oficial de Meta · Mensajes 1:1 y masivos" },
  { id: "instagram", name: "Instagram DM", icon: SiInstagram, color: "#E1306C", status: "connected", description: "DMs + Comentarios · Respuestas automáticas" },
  { id: "facebook", name: "Facebook Messenger", icon: SiFacebook, color: "#1877F2", status: "connected", description: "Messenger API · Gestión de campañas" },
];

const planFeatures = [
  "WhatsApp Business API",
  "Facebook Messenger",
  "Instagram DM",
  "1,000 mensajes marketing/mes",
  "Bot 24/7 ilimitado",
  "Bandeja unificada",
  "Hasta 5 agentes",
  "Programación horarios",
  "Escalado automático",
  "Historial de clientes",
  "Chatbot con IA",
  "Sugerencias de respuesta",
  "Etiquetado automático",
  "Reportes y métricas",
  "Soporte técnico 24/5",
];

export default function SettingsPage() {
  const { data: plan } = useGetPlan();
  const updatePlan = useUpdatePlan();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ planName: "", monthlyPrice: "", messagesLimit: "", agentsLimit: "" });
  const modules = useModules();
  // La vuelta desde Google (conectar Gmail) abre directamente su pestaña.
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "meta" || requested === "exchange" || (requested === "email" && modules.email) || (requested === "shopify" && modules.orders) ? requested : "plan";
  });

  const msgPct = plan && plan.messagesLimit > 0 ? Math.min(100, Math.round((plan.messagesUsed / plan.messagesLimit) * 100)) : 0;
  const agentPct = plan && plan.agentsLimit > 0 ? Math.min(100, Math.round((plan.agentsUsed / plan.agentsLimit) * 100)) : 0;

  const openEdit = () => {
    if (!plan) return;
    setForm({ planName: plan.planName, monthlyPrice: String(plan.monthlyPrice), messagesLimit: String(plan.messagesLimit), agentsLimit: String(plan.agentsLimit) });
    setEditOpen(true);
  };
  const saveEdit = () => {
    updatePlan.mutate(
      { data: { planName: form.planName, monthlyPrice: Number(form.monthlyPrice) || 0, messagesLimit: Number(form.messagesLimit) || 0, agentsLimit: Number(form.agentsLimit) || 0 } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetPlanQueryKey() }); setEditOpen(false); toast({ title: "Plan actualizado" }); } },
    );
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Configuración</h1>
          <p className="text-sm text-muted-foreground">Gestiona tu plan, canales y preferencias de la plataforma</p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="plan" data-testid="tab-plan">Plan y Uso</TabsTrigger>
            <TabsTrigger value="meta" data-testid="tab-meta">Conexión Meta</TabsTrigger>
            {modules.email && <TabsTrigger value="email" data-testid="tab-email">Correo</TabsTrigger>}
            <TabsTrigger value="exchange" data-testid="tab-exchange">Tasa de cambio</TabsTrigger>
            {modules.orders && <TabsTrigger value="shopify" data-testid="tab-shopify">Shopify</TabsTrigger>}
            {modules.inventory && <TabsTrigger value="usps" data-testid="tab-usps">USPS</TabsTrigger>}
          </TabsList>

          <TabsContent value="plan">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-5">
            {/* Plan card */}
            <div className="bg-card border border-primary/30 rounded-xl overflow-hidden">
              <div className="bg-primary/10 px-5 py-4 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{plan?.planName ?? "Plan Activo"} — Suscripción Mensual</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold text-primary">${plan?.monthlyPrice ?? "—"}<span className="text-sm font-normal text-muted-foreground">/mes</span></div>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={openEdit} data-testid="button-edit-plan">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </Button>
                </div>
              </div>
              <div className="p-5">
                <p className="text-xs text-muted-foreground mb-4">Renovación mensual automática · Sin contratos anuales · ITBIS incluido</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: MessageSquare, label: "Mensajería", features: planFeatures.slice(0, 5) },
                    { icon: BarChart2, label: "Gestión", features: planFeatures.slice(5, 10) },
                    { icon: Zap, label: "Inteligencia", features: planFeatures.slice(10) },
                  ].map(({ icon: Icon, label, features }) => (
                    <div key={label} className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        <Icon className="w-3.5 h-3.5" /> {label}
                      </div>
                      {features.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs text-foreground/80">
                          <CheckCircle className="w-3 h-3 text-primary flex-shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-card-border">
                  <p className="text-[10px] text-muted-foreground/60">
                    Costos adicionales NO incluidos: Minutos VoIP (US$0.30/min) · Mensajes extra (US$0.13 c/u) · Presupuesto Ads de Meta se paga directamente a Meta.
                  </p>
                </div>
              </div>
            </div>

            {/* Channel connections */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-card-border">
                <h2 className="text-sm font-semibold text-foreground">Conexiones de Canales</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Estado de las APIs de Meta</p>
              </div>
              <div className="divide-y divide-card-border">
                {channels.map((ch) => (
                  <div key={ch.id} className="px-5 py-4 flex items-center gap-4" data-testid={`channel-connection-${ch.id}`}>
                    <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                      <ch.icon className="w-4.5 h-4.5" style={{ color: ch.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{ch.name}</div>
                      <div className="text-xs text-muted-foreground">{ch.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-green-400">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Conectado
                      </div>
                      <button className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {/* Usage */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Uso del Plan</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Mensajes (este mes)</span>
                    <span className="font-medium text-foreground tabular-nums">{plan ? `${plan.messagesUsed.toLocaleString()} / ${plan.messagesLimit.toLocaleString()}` : "—"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${msgPct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{msgPct}% del límite configurado</div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Agentes</span>
                    <span className="font-medium text-foreground tabular-nums">{plan ? `${plan.agentsUsed} / ${plan.agentsLimit}` : "—"}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-all ${agentPct >= 100 ? "bg-red-400/70" : "bg-yellow-400/70"}`} style={{ width: `${agentPct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{agentPct >= 100 ? "Al límite · considera ampliar" : "Dentro del límite"}</div>
                </div>
              </div>
            </div>

            {/* API info */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Certificación Meta</h2>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  API Oficial de Meta · Cumplimiento total
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  Sin riesgo de bloqueo de cuentas
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  Plantillas aprobadas por Meta
                </div>
              </div>
            </div>

            {/* Support */}
            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Soporte Técnico</h2>
              </div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>Disponible 24/5 para soporte prioritario.</p>
                <div className="pt-2">
                  <p className="font-medium text-foreground text-xs">RVR Service</p>
                  <a href="https://www.rvrservice.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline mt-0.5">
                    www.rvrservice.com <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
            </div>
          </TabsContent>

          <TabsContent value="meta">
            <MetaIntegrations />
          </TabsContent>

          {modules.email && (
            <TabsContent value="email">
              <GmailIntegration />
            </TabsContent>
          )}

          <TabsContent value="exchange">
            <ExchangeRates />
          </TabsContent>

          {modules.orders && (
            <TabsContent value="shopify">
              <ShopifyIntegration />
            </TabsContent>
          )}

          {modules.inventory && (
            <TabsContent value="usps">
              <UspsIntegration />
            </TabsContent>
          )}
        </Tabs>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Editar plan</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nombre del plan</label>
                <Input value={form.planName} onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value }))} data-testid="input-plan-name" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Precio $/mes</label>
                  <Input type="number" value={form.monthlyPrice} onChange={(e) => setForm((f) => ({ ...f, monthlyPrice: e.target.value }))} data-testid="input-plan-price" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Límite msg</label>
                  <Input type="number" value={form.messagesLimit} onChange={(e) => setForm((f) => ({ ...f, messagesLimit: e.target.value }))} data-testid="input-plan-msglimit" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Límite agentes</label>
                  <Input type="number" value={form.agentsLimit} onChange={(e) => setForm((f) => ({ ...f, agentsLimit: e.target.value }))} data-testid="input-plan-agentlimit" />
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={saveEdit} disabled={updatePlan.isPending} data-testid="button-save-plan">Guardar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
