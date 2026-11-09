import type { ReportHeatmapCell } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Traffic density grid — one row per weekday, 24 cells per hour. Colour ramp is
// interpolated from --muted (no activity) to --primary (peak) so it inherits
// the theme.
export function Heatmap({ cells, metric = "messages" }: { cells: ReportHeatmapCell[]; metric?: "messages" | "conversations" }) {
  const grid = new Map<string, ReportHeatmapCell>();
  let max = 0;
  for (const c of cells) {
    grid.set(`${c.dayOfWeek}-${c.hour}`, c);
    const v = metric === "messages" ? c.messages : c.conversations;
    if (v > max) max = v;
  }

  const intensity = (v: number): number => (max === 0 ? 0 : v / max);
  const bg = (v: number): string => {
    if (v === 0) return "hsl(var(--muted))";
    const alpha = 0.15 + intensity(v) * 0.85;
    return `hsl(var(--primary) / ${alpha.toFixed(2)})`;
  };

  return (
    <div className="p-4" data-testid="report-heatmap">
      <div className="overflow-x-auto">
        <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `56px repeat(24, minmax(20px, 1fr))` }}>
          {/* Header row: hour labels every 3h to avoid clutter */}
          <div />
          {HOURS.map((h) => (
            <div key={h} className="text-[10px] text-muted-foreground text-center">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}

          {DAYS.map((label, d) => (
            <>
              <div key={`d-${d}`} className="text-[11px] text-muted-foreground pr-2 self-center">
                {label}
              </div>
              {HOURS.map((h) => {
                const cell = grid.get(`${d}-${h}`);
                const v = cell ? (metric === "messages" ? cell.messages : cell.conversations) : 0;
                return (
                  <div
                    key={`c-${d}-${h}`}
                    title={`${label} ${h}:00 — ${v} ${metric === "messages" ? "mensajes" : "conversaciones"}`}
                    className="h-6 rounded-sm border border-card-border/40"
                    style={{ background: bg(v) }}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
        <span>Menos</span>
        <div className="flex gap-0.5">
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <div key={step} className={cn("w-4 h-3 rounded-sm border border-card-border/40")} style={{ background: bg(step * max) }} />
          ))}
        </div>
        <span>Más</span>
        <span className="ml-auto">Zona: America/Santo_Domingo</span>
      </div>
    </div>
  );
}
