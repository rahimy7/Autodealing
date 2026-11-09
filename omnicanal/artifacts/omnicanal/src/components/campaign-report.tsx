import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Recipient = { id: number; contactName: string; phone: string | null; recipientExternalId: string | null;
  state: string; sentAt: string | null; providerSentAt: string | null; deliveredAt: string | null;
  readAt: string | null; failedAt: string | null; repliedAt: string | null; tracked: boolean; error: string | null };
type Report = { campaign: { id: number; name: string; channel: string; status: string };
  summary: { total: number; accepted: number; sent: number; delivered: number; read: number;
    failed: number; pending: number; untracked: number; replied: number }; recipients: Recipient[]; updatedAt: string };
const labels: Record<string, string> = { pending: "Pendiente", accepted: "Aceptado por Meta", sent: "Enviado",
  delivered: "Entregado", read: "Leído", failed: "Fallido", untracked: "Sin seguimiento" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("es-DO") : "—";

export function CampaignReport({ campaignId, onClose }: { campaignId: number | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["campaign-report", campaignId], enabled: campaignId !== null,
    queryFn: () => customFetch<Report>(`/api/campaigns/${campaignId}/report`, { responseType: "json" }),
    refetchInterval: campaignId !== null ? 15000 : false,
  });
  const report = query.data;
  const term = search.trim().toLocaleLowerCase();
  const rows = (report?.recipients ?? []).filter(r => !term ||
    `${r.contactName} ${r.phone ?? ""} ${r.recipientExternalId ?? ""} ${labels[r.state] ?? r.state} ${r.error ?? ""}`.toLocaleLowerCase().includes(term));
  return <Dialog open={campaignId !== null} onOpenChange={open => { if (!open) { setSearch(""); onClose(); } }}>
    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Reporte de campaña{report ? ` · ${report.campaign.name}` : ""}</DialogTitle>
        <DialogDescription>Seguimiento por destinatario. Se actualiza cada 15 segundos mientras está abierto.</DialogDescription>
      </DialogHeader>
      {query.isLoading && <p role="status">Cargando resultados…</p>}
      {query.isError && <div role="alert" className="space-y-2"><p>No se pudo cargar el reporte.</p><Button onClick={() => query.refetch()}>Reintentar</Button></div>}
      {report && <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ["Destinatarios", report.summary.total], ["Aceptados por Meta", report.summary.accepted],
            ["Enviados confirmados", report.summary.sent], ["Entregados (recibidos)", report.summary.delivered],
            ["Leídos confirmados", report.summary.read], ["Fallidos", report.summary.failed],
            ["Pendientes de envío", report.summary.pending], ["Respondieron directamente", report.summary.replied],
          ] as const).map(([label, value]) => <div key={label} className="rounded-lg border border-card-border p-3">
            <p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p>
          </div>)}
        </div>
        <p className="text-xs text-muted-foreground">Los estados son acumulativos: un mensaje leído también cuenta como entregado y enviado. «Aceptado por Meta» confirma la solicitud, sin asegurar la entrega. Una lectura sin confirmar no significa que la persona no lo haya leído.</p>
        <p className="text-xs text-muted-foreground">Entrega y lectura se registran para nuevas campañas de plantillas de WhatsApp. Los envíos anteriores y los demás canales pueden figurar sin seguimiento. Solo contamos respuestas que citan directamente el mensaje de la campaña; las demás conversaciones se ven en la bandeja.</p>
        {report.summary.untracked > 0 && <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm">{report.summary.untracked} destinatario(s) sin seguimiento de entrega o lectura. No se puede reconstruir ese historial con los datos guardados.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Buscar en el reporte" placeholder="Buscar nombre, teléfono, estado o error…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-48" />
          <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className="w-4 h-4 mr-2" />Actualizar</Button>
          <span className="text-xs text-muted-foreground">Actualizado: {date(report.updatedAt)}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-card-border">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Resultados por contacto de {report.campaign.name}</caption>
            <thead className="bg-muted/30"><tr>{["Contacto", "Estado", "Aceptado", "Entregado", "Leído", "Respuesta directa", "Detalle del error"].map(label => <th key={label} scope="col" className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} className="border-t border-card-border align-top">
              <td className="p-3"><p className="font-medium">{r.contactName}</p><p className="text-muted-foreground">{r.phone ?? r.recipientExternalId ?? "—"}</p></td>
              <td className={`p-3 whitespace-nowrap ${r.state === "failed" ? "text-red-500" : r.state === "read" ? "text-blue-500" : ""}`}>{labels[r.state] ?? r.state}</td>
              <td className="p-3 whitespace-nowrap">{date(r.sentAt)}</td><td className="p-3 whitespace-nowrap">{r.deliveredAt ? date(r.deliveredAt) : r.readAt ? "Confirmado por lectura" : "—"}</td>
              <td className="p-3 whitespace-nowrap">{date(r.readAt)}</td><td className="p-3 whitespace-nowrap">{date(r.repliedAt)}</td>
              <td className="p-3 min-w-48 break-words">{r.error ?? "—"}</td>
            </tr>)}</tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No hay destinatarios que coincidan.</p>}
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
