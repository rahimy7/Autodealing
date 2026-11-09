import type { ReportLocalityStat } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { MapPin } from "lucide-react";

function rateColor(rate: number): string {
  return rate >= 70
    ? "text-green-600"
    : rate >= 40
      ? "text-yellow-600"
      : "text-red-600";
}

export function LocalityBreakdown({ rows }: { rows: ReportLocalityStat[] }) {
  const maxConv = Math.max(...rows.map((r) => r.conversations), 1);
  if (rows.length === 0) {
    return (
      <div className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4" /> No hay sucursales configuradas ni conversaciones asociadas a una sucursal.
      </div>
    );
  }
  return (
    <div className="p-5 space-y-3">
      {rows.map((r) => (
        <div key={r.localityLabelId ?? "none"} data-testid={`report-locality-${r.localityLabelId ?? "none"}`} title={`${r.conversations} conversaciones · ${r.resolved} resueltas · ${r.share}% del total`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: r.color }} />
            <span className="text-sm font-medium text-foreground truncate">{r.localityName}</span>
            <span className={cn("text-[11px] font-medium ml-2", rateColor(r.resolutionRate))}>{r.resolutionRate}% resueltas</span>
            <span className="ml-auto text-xs font-semibold text-foreground tabular-nums">{r.conversations}</span>
            <span className="text-[11px] text-muted-foreground w-10 text-right tabular-nums">{r.share}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.conversations / maxConv) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
