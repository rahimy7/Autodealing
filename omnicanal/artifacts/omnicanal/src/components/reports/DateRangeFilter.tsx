import { useState } from "react";
import { Calendar, CalendarRange, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
// Los días del negocio se leen y se pintan en un solo sitio (lib/day), porque el
// panel de control los usa igual que los reportes.
import { formatDayKey, shiftDay, todayInZone } from "@/lib/day";

export { formatDayKey, shiftDay, todayInZone };

// A range described either as a preset "last N days" (today included) or a
// custom [from, to] of business days. The same day in both is a single date.
export type ReportRange =
  | { kind: "preset"; days: number }
  | { kind: "custom"; from: string; to: string };

const PRESETS: { days: number; label: string }[] = [
  { days: 1, label: "Hoy" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

export function periodLabel(from: string, to: string): string {
  if (from.slice(0, 10) === to.slice(0, 10)) return formatDayKey(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${formatDayKey(from, { day: "numeric", month: "short", year: "numeric" })} → ${formatDayKey(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function rangeToParams(range: ReportRange): { days?: number; from?: string; to?: string } {
  return range.kind === "preset" ? { days: range.days } : { from: range.from, to: range.to };
}

export function DateRangeFilter({
  value,
  onChange,
  onExport,
  isExporting,
}: {
  value: ReportRange;
  onChange: (r: ReportRange) => void;
  onExport?: () => void;
  isExporting?: boolean;
}) {
  const today = todayInZone(useClient().locale.timezone);
  const [mode, setMode] = useState<"day" | "range" | null>(
    value.kind === "custom" ? (value.from === value.to ? "day" : "range") : null,
  );
  const [day, setDay] = useState(value.kind === "custom" ? value.to : today);
  const [from, setFrom] = useState(value.kind === "custom" ? value.from : shiftDay(today, -6));
  const [to, setTo] = useState(value.kind === "custom" ? value.to : today);

  const pickDay = (next: string) => {
    if (!next || next > today) return;
    setDay(next);
    onChange({ kind: "custom", from: next, to: next });
  };
  const pickRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom && nextTo && nextFrom <= nextTo) onChange({ kind: "custom", from: nextFrom, to: nextTo });
  };

  const tab = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 bg-card border border-card-border rounded-lg p-1" role="group" aria-label="Periodo">
        {PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => {
              setMode(null);
              onChange({ kind: "preset", days: p.days });
            }}
            data-testid={`report-period-${p.days}`}
            className={tab(value.kind === "preset" && value.days === p.days)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setMode("day");
            onChange({ kind: "custom", from: day, to: day });
          }}
          data-testid="report-period-day"
          className={tab(value.kind === "custom" && mode === "day")}
        >
          <Calendar className="w-3.5 h-3.5" /> Fecha
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("range");
            pickRange(from, to);
          }}
          data-testid="report-period-custom"
          className={tab(value.kind === "custom" && mode === "range")}
        >
          <CalendarRange className="w-3.5 h-3.5" /> Rango
        </button>
      </div>

      {mode === "day" && (
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg px-1 py-1">
          <button
            type="button"
            onClick={() => pickDay(shiftDay(day, -1))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Día anterior"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => pickDay(e.target.value)}
            className="text-xs bg-transparent focus:outline-none px-1"
            aria-label="Fecha"
            data-testid="report-period-day-input"
          />
          <button
            type="button"
            onClick={() => pickDay(shiftDay(day, 1))}
            disabled={day >= today}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Día siguiente"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {mode === "range" && (
        <div className="flex items-center gap-2 bg-card border border-card-border rounded-lg px-2 py-1">
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => pickRange(e.target.value, to)}
            className="text-xs bg-transparent focus:outline-none px-1"
            aria-label="Desde"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => pickRange(from, e.target.value)}
            className="text-xs bg-transparent focus:outline-none px-1"
            aria-label="Hasta"
          />
        </div>
      )}

      {onExport && (
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          data-testid="report-export-csv"
          className="ml-auto flex items-center gap-1.5 text-xs font-medium bg-card border border-card-border rounded-lg px-3 py-1.5 hover:bg-muted disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" /> {isExporting ? "Exportando…" : "Exportar CSV"}
        </button>
      )}
    </div>
  );
}
