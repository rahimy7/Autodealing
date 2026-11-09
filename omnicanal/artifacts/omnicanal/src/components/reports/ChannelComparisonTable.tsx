import type { ReportChannelStat } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { CHANNEL_META } from "./channels";

function fmtMin(m: number): string {
  if (m <= 0) return "—";
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function rateColor(rate: number): string {
  return rate >= 70
    ? "bg-green-500/15 text-green-600"
    : rate >= 40
      ? "bg-yellow-500/15 text-yellow-600"
      : "bg-red-500/15 text-red-600";
}

export function ChannelComparisonTable({ rows }: { rows: ReportChannelStat[] }) {
  return (
    <div className="overflow-x-auto" data-testid="report-channel-comparison">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="border-b border-card-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-4 py-3">Canal</th>
            <th className="text-right font-medium px-3 py-3">Conversaciones</th>
            <th className="text-right font-medium px-3 py-3">Tasa resolución</th>
            <th className="text-right font-medium px-3 py-3">Recibidos / enviados</th>
            <th className="text-right font-medium px-3 py-3">1ª resp avg</th>
            <th className="text-right font-medium px-3 py-3">1ª resp p95</th>
            <th className="text-right font-medium px-3 py-3">Resolución avg</th>
            <th className="text-right font-medium px-3 py-3">Msg/conv</th>
            <th className="text-right font-medium px-4 py-3">Nuevos / recurrentes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = CHANNEL_META[r.channel];
            return (
              <tr key={r.channel} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`report-channel-row-${r.channel}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {meta && <meta.Icon className="w-4 h-4" style={{ color: meta.color }} />}
                    <span className="font-medium text-foreground">{meta?.label ?? r.channel}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{r.conversations}</td>
                <td className="px-3 py-3 text-right">
                  <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateColor(r.resolutionRate))}>{r.resolutionRate}%</span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                  {r.inboundMessages.toLocaleString("es-DO")} / {r.outboundMessages.toLocaleString("es-DO")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtMin(r.avgFirstResponseMinutes)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtMin(r.p95FirstResponseMinutes)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtMin(r.avgResolutionMinutes)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.avgMessagesPerConversation.toFixed(1)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  <span className="text-green-600 font-medium">{r.newContacts}</span> / {r.returningContacts}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">
                Sin datos de canales en el periodo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
