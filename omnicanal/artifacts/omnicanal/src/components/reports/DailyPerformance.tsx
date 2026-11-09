import type { ReportDailyStat } from "@workspace/api-client-react";
import { Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDayKey } from "./DateRangeFilter";
import { CHANNEL_META, type ReportChannel } from "./channels";

const SALES_COLOR = "#f59e0b";

function DeltaTile({
  label,
  value,
  previous,
  suffix = "",
  isLoading,
}: {
  label: string;
  value: number;
  previous?: number | null;
  suffix?: string;
  isLoading?: boolean;
}) {
  // Sin nada antes con qué dividir, el cambio no se puede poner en porcentaje:
  // de 0 a 50 no es "+100%". Se dice "nuevo" y el "antes: 0" lo termina de contar.
  const delta = previous == null || previous === 0 ? null : Math.round(((value - previous) / previous) * 100);
  const up = delta === null ? value > 0 : delta > 0;
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-lg font-bold text-foreground tabular-nums">
          {value.toLocaleString("es-DO")}
          {suffix}
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {!isLoading && previous != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              delta === 0 || (delta === null && !up) ? "text-muted-foreground" : up ? "text-green-600" : "text-red-600",
            )}
          >
            {delta === 0 || (delta === null && !up) ? <Minus className="w-3 h-3" /> : up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {delta === null ? (up ? "nuevo" : "sin datos") : `${Math.abs(delta)}%`}
          </span>
        )}
      </div>
      {!isLoading && previous != null && (
        <div className="text-[11px] text-muted-foreground/70 mt-0.5">
          antes: {previous.toLocaleString("es-DO")}
          {suffix}
        </div>
      )}
    </div>
  );
}

export function DailyComparisonBar({
  current,
  previous,
  previousLabel,
  enabled,
  onToggle,
  isLoading,
}: {
  current: { conversations: number; sales: number };
  previous: { conversations: number; sales: number } | null;
  previousLabel: string | null;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  isLoading: boolean;
}) {
  const conversionRate = current.conversations ? Math.round((current.sales / current.conversations) * 100) : 0;
  const previousConversionRate =
    previous != null ? (previous.conversations ? Math.round((previous.sales / previous.conversations) * 100) : 0) : null;

  return (
    <div className="p-5 space-y-4">
      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer w-fit select-none" data-testid="report-daily-compare-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 rounded border-card-border accent-primary"
        />
        Comparar con el periodo anterior (mismo número de días, justo antes)
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DeltaTile label="Conversaciones" value={current.conversations} previous={enabled ? previous?.conversations ?? null : null} isLoading={enabled && isLoading} />
        <DeltaTile label="Ventas" value={current.sales} previous={enabled ? previous?.sales ?? null : null} isLoading={enabled && isLoading} />
        <DeltaTile
          label="Tasa de conversión"
          value={conversionRate}
          suffix="%"
          previous={enabled ? previousConversionRate : null}
          isLoading={enabled && isLoading}
        />
      </div>
      {enabled && previousLabel && !isLoading && (
        <p className="text-[11px] text-muted-foreground">Periodo anterior: {previousLabel}.</p>
      )}
    </div>
  );
}

export function DailyChannelChart({ rows, channels }: { rows: ReportDailyStat[]; channels: ReportChannel[] }) {
  const data = rows.map((r) => {
    const point: Record<string, string | number> = { date: formatDayKey(r.date, { month: "short", day: "numeric" }) };
    for (const ch of channels) point[ch] = r.byChannel.find((c) => c.channel === ch)?.conversations ?? 0;
    point.sales = r.sales;
    return point;
  });

  return (
    <div className="p-5 pt-4">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} minTickGap={20} />
          <YAxis yAxisId="conv" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis yAxisId="sales" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
          />
          {channels.map((ch) => (
            <Bar key={ch} yAxisId="conv" dataKey={ch} stackId="channels" fill={CHANNEL_META[ch].color} name={CHANNEL_META[ch].label} />
          ))}
          <Line yAxisId="sales" type="monotone" dataKey="sales" stroke={SALES_COLOR} strokeWidth={2} dot={{ r: 3 }} name="Ventas" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
        {channels.map((ch) => (
          <span key={ch} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHANNEL_META[ch].color }} /> {CHANNEL_META[ch].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: SALES_COLOR }} /> Ventas
        </span>
      </div>
    </div>
  );
}

export function DailyBreakdownTable({ rows, channels }: { rows: ReportDailyStat[]; channels: ReportChannel[] }) {
  return (
    <div className="overflow-x-auto" data-testid="report-daily-table">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-card-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-4 py-3">Fecha</th>
            {channels.map((ch) => {
              const meta = CHANNEL_META[ch];
              return (
                <th key={ch} className="text-right font-medium px-3 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    {meta.label}
                  </span>
                </th>
              );
            })}
            <th className="text-right font-medium px-3 py-3">Total</th>
            <th className="text-right font-medium px-4 py-3">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`report-daily-row-${r.date}`}>
              <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                {formatDayKey(r.date, { weekday: "short", day: "numeric", month: "short" })}
              </td>
              {channels.map((ch) => {
                const c = r.byChannel.find((b) => b.channel === ch);
                return (
                  <td key={ch} className="px-3 py-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {c?.conversations ?? 0}
                    {!!c?.sales && <span className="ml-1 text-[11px] text-green-600 font-medium">({c.sales} venta{c.sales === 1 ? "" : "s"})</span>}
                  </td>
                );
              })}
              <td className="px-3 py-3 text-right font-semibold text-foreground tabular-nums">{r.conversations}</td>
              <td className="px-4 py-3 text-right">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", r.sales > 0 ? "bg-green-500/15 text-green-600" : "text-muted-foreground")}>
                  {r.sales}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={channels.length + 3} className="px-4 py-8 text-center text-muted-foreground text-sm">
                Sin datos en el periodo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
