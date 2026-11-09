import { ChevronDown, Mail, MailOpen, Mails } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ReadFilter = "all" | "unread" | "read";

const OPTIONS: { value: ReadFilter; label: string; icon: typeof Mail }[] = [
  { value: "all", label: "Todos", icon: Mails },
  { value: "unread", label: "No leídos", icon: Mail },
  { value: "read", label: "Leídos", icon: MailOpen },
];

/**
 * Leído / no leído, pegado al buscador. Va en un menú y no en otra fila de
 * botones: el panel de la lista es estrecho y ya carga canal, número y estado.
 * Sin filtro es solo un icono; con uno activo se resalta y dice cuál es.
 */
export function ReadFilterMenu({
  value,
  onChange,
  testId,
}: {
  value: ReadFilter;
  onChange: (next: ReadFilter) => void;
  testId?: string;
}) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  const active = value !== "all";
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Filtrar por leídos / no leídos"
          aria-label={`Leídos: ${current.label}`}
          className={cn(
            "flex-shrink-0 inline-flex items-center gap-1 px-2 rounded-lg border text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
            active
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
          data-testid={testId}
        >
          <Icon className="w-3.5 h-3.5" />
          {active && <span className="whitespace-nowrap">{current.label}</span>}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Mostrar</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ReadFilter)}>
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem
              key={o.value}
              value={o.value}
              className="text-xs gap-2"
              data-testid={testId ? `${testId}-${o.value}` : undefined}
            >
              <o.icon className="w-3.5 h-3.5 text-muted-foreground" />
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
