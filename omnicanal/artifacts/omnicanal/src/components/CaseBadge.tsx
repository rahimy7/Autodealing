import { useLocation } from "wouter";
import { FolderOpen } from "lucide-react";
import type { CaseType, CaseStatus, CasePriority, CaseResolutionKind } from "@workspace/api-client-react";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Un mapa por concepto, exportado: lo usan la vista de Casos, la pastilla del
// hilo de correo y el detalle, y repetirlos era garantía de que se
// desincronizaran.
export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  prayer_request: "Petición de oración",
  visitation: "Visitación",
  bible_study: "Estudio bíblico",
  worship: "Culto",
  volume_discount: "Descuento por volumen",
  partnership: "Afiliados, distribución o alianza",
  subscription: "Afiliación o desafiliación",
  order_status: "Estado del pedido",
  order_error: "Error en el pedido",
  theft_report: "Robo o fraude",
  payment_issue: "Problema de pago",
  refund: "Devolución de dinero",
  cancellation: "Cancelación",
  address_change: "Cambio de datos de envío",
  product_quality: "Calidad del producto",
  product_question: "Consulta sobre el producto",
  other: "Otra petición",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Abierto",
  in_progress: "En gestión",
  waiting_customer: "Esperando al cliente",
  resolved: "Resuelto",
  cancelled: "Cancelado",
};

export const CASE_STATUS_STYLES: Record<CaseStatus, string> = {
  open: "bg-amber-500/12 text-amber-600",
  in_progress: "bg-sky-500/12 text-sky-600",
  waiting_customer: "bg-purple-500/12 text-purple-600",
  resolved: "bg-emerald-500/12 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground",
};

export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const CASE_PRIORITY_STYLES: Record<CasePriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-slate-500/12 text-slate-500",
  high: "bg-orange-500/15 text-orange-600",
  urgent: "bg-red-500/15 text-red-600",
};

export const CASE_RESOLUTION_LABELS: Record<CaseResolutionKind, string> = {
  answered: "Se resolvió respondiendo",
  actioned: "Se resolvió accionando",
  rejected: "Atendido, no procede",
};

/** Pastilla de un caso, para colgarla de donde nació (un hilo de correo, un chat). */
export function CaseBadge({
  caseRow,
  className,
}: {
  caseRow: { id: number; code: string; status: CaseStatus; subject: string; priority: CasePriority };
  className?: string;
}) {
  const [, setLocation] = useLocation();
  const church = useClient().id === "linaje-real";
  const status = church ? ({ open: "Pendiente", in_progress: "En atención", waiting_customer: "Esperando respuesta", resolved: "Atendida", cancelled: "Cancelada" } as const)[caseRow.status] : CASE_STATUS_LABELS[caseRow.status];
  return (
    <button
      type="button"
      onClick={() => setLocation(`/cases?case=${caseRow.id}`)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors hover:opacity-80",
        caseRow.priority === "urgent" ? CASE_PRIORITY_STYLES.urgent : CASE_STATUS_STYLES[caseRow.status],
        className,
      )}
      title={`${caseRow.code} · ${caseRow.subject} — ver en ${church ? "Peticiones" : "Casos"}`}
      data-testid={`case-badge-${caseRow.id}`}
    >
      <FolderOpen className="w-3 h-3 flex-shrink-0" />
      {caseRow.code} · {status}
    </button>
  );
}
