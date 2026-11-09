import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShopifySubscribers,
  useSyncShopifySubscribers,
  getListShopifySubscribersQueryKey,
  type ShopifySubscriber,
  type ShopifySubscriberStatus,
} from "@workspace/api-client-react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Repeat, Search } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents } from "@/lib/money";

// Suscripciones (2026-10-06): los clientes de Shopify con suscripción y el estado
// que da Shopify por cliente. Los contratos (próximo cobro, frecuencia) son de la
// app de suscripciones de la tienda y se gestionan en Shopify: de aquí se salta a
// la ficha del cliente allá.

export const SUBSCRIBER_STATUS_LABELS: Record<ShopifySubscriberStatus, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  FAILED: "Pago fallido",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

const SUBSCRIBER_STATUS_STYLES: Record<ShopifySubscriberStatus, string> = {
  ACTIVE: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  PAUSED: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  FAILED: "bg-red-500/12 text-red-600 dark:text-red-400",
  CANCELLED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-muted text-muted-foreground",
};

const TABS: Array<{ key: ShopifySubscriberStatus | "all"; label: string }> = [
  { key: "ACTIVE", label: "Activas" },
  { key: "PAUSED", label: "Pausadas" },
  { key: "FAILED", label: "Pago fallido" },
  { key: "CANCELLED", label: "Canceladas" },
  { key: "EXPIRED", label: "Vencidas" },
  { key: "all", label: "Todas" },
];

function fmtDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function fmtDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "nunca";
}

function daysAgo(value: string): string {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

function StatusBadge({ subscriber }: { subscriber: ShopifySubscriber }) {
  const previous = subscriber.previousStatus as ShopifySubscriberStatus | null | undefined;
  return (
    <div className="space-y-0.5">
      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium", SUBSCRIBER_STATUS_STYLES[subscriber.status])}>
        {SUBSCRIBER_STATUS_LABELS[subscriber.status]}
      </span>
      {subscriber.statusChangedAt && (
        <div className="text-[11px] text-muted-foreground" title="Cuándo se vio el cambio al releer Shopify">
          desde {fmtDate(subscriber.statusChangedAt)}
          {previous && SUBSCRIBER_STATUS_LABELS[previous] ? ` · antes ${SUBSCRIBER_STATUS_LABELS[previous].toLowerCase()}` : ""}
        </div>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ShopifySubscriberStatus | "all">("ACTIVE");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { ...(tab !== "all" ? { status: tab } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) };
  const { data, isLoading } = useListShopifySubscribers(params, {
    query: {
      queryKey: getListShopifySubscribersQueryKey(params),
      // Mientras se relee la tienda, se mira cada pocos segundos hasta que termine.
      refetchInterval: (query) => (query.state.data?.refreshing ? 3000 : false),
    },
  });
  const sync = useSyncShopifySubscribers();

  const refresh = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        void queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
        if (r.error) toast({ title: r.error, variant: "destructive" });
        else toast({ title: r.started ? "Leyendo los suscriptores de Shopify…" : "Ya se estaba leyendo: en un momento se actualiza." });
      },
      onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo actualizar"), variant: "destructive" }),
    });

  const rows = data?.items ?? [];
  const counts = data?.counts;
  const activeLabel = TABS.find((t) => t.key === tab)?.label.toLowerCase() ?? "";

  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Suscripciones</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Los clientes con suscripción en Shopify y su estado. El próximo cobro y la frecuencia se gestionan en la app de suscripciones de la tienda: el enlace abre al cliente en Shopify.
            </p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={sync.isPending || data?.refreshing || data?.connected === false} className="gap-1.5" data-testid="button-subscribers-refresh">
            <RefreshCw className={cn("w-4 h-4", (sync.isPending || data?.refreshing) && "animate-spin")} /> Actualizar desde Shopify
          </Button>
        </div>

        {data && !data.connected && data.total === 0 && !debouncedSearch ? (
          <div className="bg-card border border-card-border rounded-xl p-8 text-center space-y-2">
            <Repeat className="w-7 h-7 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">Shopify no está conectado.</p>
            <Link href="/settings?tab=shopify" className="text-sm text-primary hover:underline">
              Conectar en Configuración → Shopify
            </Link>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              {data && !data.connected && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" /> Shopify no está conectado: es la última lista que se leyó.
                  <Link href="/settings?tab=shopify" className="text-primary hover:underline">
                    Conectar
                  </Link>
                </span>
              )}
              {data?.refreshing ? (
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo los clientes de la tienda…
                </span>
              ) : (
                <span>Actualizado: {fmtDateTime(data?.syncedAt)} · se relee solo cada 6 horas</span>
              )}
              {data?.error && (
                <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5" /> {data.error}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    data-testid={`tab-subscribers-${t.key}`}
                    className={cn(
                      "text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
                      tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {t.label}
                    {counts && <span className="ml-1 opacity-70">{t.key === "all" ? data?.total : counts[t.key]}</span>}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, correo o teléfono…" className="pl-8 h-9 text-sm" data-testid="input-subscribers-search" />
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              {isLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />)}</div>
              ) : rows.length === 0 ? (
                <div className="p-10 text-center">
                  <Repeat className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {data?.syncedAt || data?.refreshing ? `No hay suscripciones${tab !== "all" ? ` ${activeLabel}` : ""}${debouncedSearch ? " que coincidan" : ""}.` : "Todavía no se ha leído la lista: pulsa Actualizar desde Shopify."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="border-b border-card-border text-xs text-muted-foreground">
                        <th className="text-left font-medium px-4 py-3">Cliente</th>
                        <th className="text-left font-medium px-3 py-3">Estado</th>
                        <th className="text-left font-medium px-3 py-3">Suscripción</th>
                        <th className="text-left font-medium px-3 py-3">Último pedido</th>
                        <th className="text-right font-medium px-3 py-3">Pedidos</th>
                        <th className="text-right font-medium px-3 py-3">Gastado</th>
                        <th className="text-left font-medium px-3 py-3">Cliente desde</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.id} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`subscriber-row-${s.id}`}>
                          <td className="px-4 py-3">
                            {s.contactId != null ? (
                              <Link href={`/contacts/${s.contactId}`} className="font-medium text-primary hover:underline">
                                {s.name ?? "Sin nombre"}
                              </Link>
                            ) : (
                              <div className="font-medium text-foreground">{s.name ?? "Sin nombre"}</div>
                            )}
                            <div className="text-xs text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(" · ") || "—"}</div>
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge subscriber={s} />
                          </td>
                          <td className="px-3 py-3 max-w-[260px]">
                            <div className="text-foreground line-clamp-2">{s.lastOrderProducts ?? "—"}</div>
                            {s.sellingPlan && <div className="text-[11px] text-muted-foreground line-clamp-1">{s.sellingPlan}</div>}
                          </td>
                          <td className="px-3 py-3">
                            {s.lastOrderAt ? (
                              <>
                                <div className="text-foreground">
                                  {s.lastOrderName ?? "—"} · {fmtDate(s.lastOrderAt)}
                                </div>
                                <div className="text-[11px] text-muted-foreground">{daysAgo(s.lastOrderAt)}</div>
                              </>
                            ) : (
                              <span className="text-muted-foreground" title="Shopify solo deja ver los pedidos de los últimos 60 días">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{s.ordersCount}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatCents(s.amountSpentCents, s.currency)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{fmtDate(s.customerSince)}</td>
                          <td className="px-4 py-3 text-right">
                            {s.shopifyAdminUrl && (
                              <a
                                href={s.shopifyAdminUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
                                data-testid={`link-subscriber-shopify-${s.id}`}
                              >
                                Ver en Shopify <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              El estado es por cliente: con una suscripción activa y otra cancelada, sale Activa. Los pedidos de suscripción están en Pedidos, con el filtro Suscripciones.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
