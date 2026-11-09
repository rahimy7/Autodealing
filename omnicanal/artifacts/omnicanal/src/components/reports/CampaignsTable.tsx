import type { ReportCampaignStat } from "@workspace/api-client-react";
import { CHANNEL_META } from "./channels";

export function CampaignsTable({ rows }: { rows: ReportCampaignStat[] }) {
  return (
    <div className="overflow-x-auto" data-testid="report-campaigns-table">
      <table className="w-full text-sm min-w-[620px]">
        <thead>
          <tr className="border-b border-card-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-4 py-3">Canal</th>
            <th className="text-right font-medium px-3 py-3">Campañas</th>
            <th className="text-right font-medium px-3 py-3">Destinatarios</th>
            <th className="text-right font-medium px-3 py-3">Enviados</th>
            <th className="text-right font-medium px-3 py-3">Fallidos</th>
            <th className="text-right font-medium px-4 py-3">Éxito</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = CHANNEL_META[r.channel];
            return (
              <tr key={r.channel} className="border-b border-card-border/60 hover:bg-muted/40" data-testid={`report-campaign-row-${r.channel}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {meta && <meta.Icon className="w-4 h-4" style={{ color: meta.color }} />}
                    <span className="font-medium text-foreground">{meta?.label ?? r.channel}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{r.campaignsSent}</td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{r.recipients.toLocaleString("es-DO")}</td>
                <td className="px-3 py-3 text-right tabular-nums text-green-600">{r.sent.toLocaleString("es-DO")}</td>
                <td className="px-3 py-3 text-right tabular-nums text-red-500">{r.failed.toLocaleString("es-DO")}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {r.recipients ? `${Math.round((r.sent / r.recipients) * 100)}%` : "—"}
                </td>
              </tr>
            );
          })}
          {rows.every((r) => r.campaignsSent === 0) && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                No hubo envíos de campañas en el periodo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="px-4 py-3 text-[11px] text-muted-foreground">
        Enviados son los que Meta aceptó y fallidos los que rechazó. Meta no informa entregas ni aperturas de las campañas, así que no se muestran.
      </p>
    </div>
  );
}
