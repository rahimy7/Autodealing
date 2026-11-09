import { useQueryClient } from "@tanstack/react-query";
import {
  useGetExchangeRates,
  useRefreshExchangeRates,
  useListExchangeRateHistory,
  getGetExchangeRatesQueryKey,
  getListExchangeRateHistoryQueryKey,
  type ExchangeRate,
} from "@workspace/api-client-react";
import { Landmark, Loader2, RefreshCw, XCircle, Clock, History, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const HISTORY_LIMIT = 60;
const CURRENCY_NAMES: Record<string, string> = { USD: "Dólar estadounidense", EUR: "Euro" };
const CURRENCY_ORDER = ["USD", "EUR"];
const REQUIRED_VARS = ["PopularApi__ClientId", "PopularApi__ClientSecret", "PopularApi__TokenUrl", "PopularApi__BaseUrl"];

const rateFormat = new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function fmtRate(value: number | undefined) {
  return value === undefined ? "—" : `RD$ ${rateFormat.format(value)}`;
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
}

function originLabel(rate: Pick<ExchangeRate, "fetchedBy">) {
  return rate.fetchedBy ? `A mano · ${rate.fetchedBy}` : "Automática";
}

function byCurrency(a: { currency: string }, b: { currency: string }) {
  const rank = (c: string) => (CURRENCY_ORDER.includes(c) ? CURRENCY_ORDER.indexOf(c) : CURRENCY_ORDER.length);
  return rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency);
}

// Cada consulta guarda una fila por moneda con la misma hora: se juntan para
// enseñar la consulta completa en una sola línea.
function groupByFetch(rows: ExchangeRate[]) {
  const groups = new Map<string, { createdAt: string; fetchedBy: string | null; rates: Record<string, ExchangeRate> }>();
  for (const row of rows) {
    const group = groups.get(row.createdAt) ?? { createdAt: row.createdAt, fetchedBy: row.fetchedBy ?? null, rates: {} };
    group.rates[row.currency] = row;
    groups.set(row.createdAt, group);
  }
  return [...groups.values()];
}

export default function ExchangeRates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetExchangeRates();
  const { data: history } = useListExchangeRateHistory({ limit: HISTORY_LIMIT });
  const refresh = useRefreshExchangeRates();

  async function handleRefresh() {
    try {
      const status = await refresh.mutateAsync();
      queryClient.setQueryData(getGetExchangeRatesQueryKey(), status);
      toast({ title: "Tasa actualizada desde el Banco Popular" });
    } catch {
      // El motivo queda en la tarjeta (lastError), que es más legible que el toast.
      toast({ title: "No se pudo consultar la tasa", variant: "destructive" });
      await queryClient.invalidateQueries({ queryKey: getGetExchangeRatesQueryKey() });
    } finally {
      await queryClient.invalidateQueries({ queryKey: getListExchangeRateHistoryQueryKey({ limit: HISTORY_LIMIT }) });
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const rates = [...data.rates].sort(byCurrency);
  const lastUpdate = rates.reduce<string | null>((latest, r) => (!latest || r.createdAt > latest ? r.createdAt : latest), null);
  const lastUpdateBy = rates.find((r) => r.createdAt === lastUpdate);
  const fetches = groupByFetch(history ?? []);
  const historyCurrencies = CURRENCY_ORDER.filter((c) => (history ?? []).some((r) => r.currency === c));
  const refreshHour = `${String(data.refreshHour).padStart(2, "0")}:00`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Landmark className="w-4 h-4 text-primary" /> Tasa de cambio
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Compra y venta del día frente al peso dominicano, tomadas de la API del {data.provider}.
        </p>
      </div>

      {/* Tasa vigente */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid="exchange-rates-card">
        <div className="px-5 py-4 border-b border-card-border flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Tasa del día</h3>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1">
              <Clock className="w-3 h-3 flex-shrink-0 mt-0.5" />
              {lastUpdate ? `Actualizada ${fmtDateTime(lastUpdate)} · ${lastUpdateBy ? originLabel(lastUpdateBy) : ""}` : "Aún no se ha consultado"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={!data.configured || refresh.isPending}
            data-testid="button-refresh-exchange-rates"
          >
            {refresh.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
            Consultar ahora
          </Button>
        </div>

        <div className="p-5 space-y-4">
          {!data.configured && (
            <div className="rounded-lg border border-card-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground space-y-2">
              <p className="flex items-center gap-1.5 text-foreground font-medium">
                <KeyRound className="w-3.5 h-3.5" /> La instancia no tiene las credenciales de la API del banco
              </p>
              <p>
                Agrega estas variables de entorno al servicio (las da el portal de APIs del Banco Popular) y reinícialo:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REQUIRED_VARS.map((v) => (
                  <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                    {v}
                  </code>
                ))}
              </div>
            </div>
          )}

          {data.lastError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {data.lastError}
                {data.lastErrorAt && <span className="opacity-70"> · {fmtDateTime(data.lastErrorAt)}</span>}
              </span>
            </div>
          )}

          {rates.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rates.map((rate) => (
                <div key={rate.currency} className="rounded-lg border border-card-border p-4" data-testid={`exchange-rate-${rate.currency}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{rate.currency} → DOP</span>
                    <span className="text-[11px] text-muted-foreground truncate">{CURRENCY_NAMES[rate.currency] ?? rate.currency}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Compra</div>
                      <div className="text-lg font-semibold text-foreground tabular-nums">{fmtRate(rate.buy)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Venta</div>
                      <div className="text-lg font-semibold text-primary tabular-nums">{fmtRate(rate.sell)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            data.configured && <p className="text-xs text-muted-foreground">Todavía no hay tasas guardadas. Pulsa «Consultar ahora».</p>
          )}

          {data.configured && (
            <p className="text-[11px] text-muted-foreground">
              Se consulta sola todos los días a partir de las {refreshHour} ({data.timezone}), y también cuando un agente virtual la
              necesita y la guardada no es de hoy. Los agentes dan los montos en pesos con la tasa de «Venta»: lo que cobra el banco por
              cada dólar. Si no hay tasa de hoy, esa pregunta pasa a una persona.
            </p>
          )}
        </div>
      </div>

      {/* Historial */}
      {fetches.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-card-border flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Historial de consultas</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-card-border text-muted-foreground">
                  <th className="text-left font-medium px-5 py-2.5">Fecha</th>
                  {historyCurrencies.map((c) => (
                    <th key={c} className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                      {c} compra / venta
                    </th>
                  ))}
                  <th className="text-left font-medium px-5 py-2.5">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {fetches.map((entry) => (
                  <tr key={entry.createdAt}>
                    <td className="px-5 py-2.5 whitespace-nowrap text-foreground">{fmtDateTime(entry.createdAt)}</td>
                    {historyCurrencies.map((c) => {
                      const rate = entry.rates[c];
                      return (
                        <td key={c} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-foreground">
                          {rate ? `${rateFormat.format(rate.buy)} / ${rateFormat.format(rate.sell)}` : "—"}
                        </td>
                      );
                    })}
                    <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{originLabel(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
