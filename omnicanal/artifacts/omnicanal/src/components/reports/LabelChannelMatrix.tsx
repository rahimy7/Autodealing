import type { ReportLabelChannelCell } from "@workspace/api-client-react";
import { CHANNEL_META, type ReportChannel } from "./channels";

// Sparse label × channel matrix flattened into a dense table so admins can spot
// which intents dominate each channel.
export function LabelChannelMatrix({ cells, channels }: { cells: ReportLabelChannelCell[]; channels: readonly ReportChannel[] }) {
  const labels = new Map<string, { labelId: number | null; labelName: string; color: string; total: number; byChannel: Record<string, number> }>();
  for (const c of cells) {
    const key = c.labelId == null ? "none" : String(c.labelId);
    const row = labels.get(key) ?? { labelId: c.labelId, labelName: c.labelName, color: c.color, total: 0, byChannel: {} };
    row.byChannel[c.channel] = (row.byChannel[c.channel] ?? 0) + c.conversations;
    row.total += c.conversations;
    labels.set(key, row);
  }
  const rows = Array.from(labels.values()).sort((a, b) => b.total - a.total);

  if (rows.length === 0) {
    return <p className="p-5 text-sm text-muted-foreground text-center">Sin datos por etiqueta y canal.</p>;
  }

  return (
    <div className="overflow-x-auto" data-testid="report-label-channel-matrix">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="border-b border-card-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-4 py-3">Etiqueta</th>
            {channels.map((ch) => {
              const meta = CHANNEL_META[ch];
              return (
                <th key={ch} className="text-right font-medium px-3 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    {meta.label}
                  </span>
                </th>
              );
            })}
            <th className="text-right font-medium px-4 py-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.labelId ?? "none"} className="border-b border-card-border/60">
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />
                  <span className="font-medium text-foreground">{r.labelName}</span>
                </span>
              </td>
              {channels.map((ch) => (
                <td key={ch} className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {r.byChannel[ch] ?? 0}
                </td>
              ))}
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
