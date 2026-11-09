import { SiWhatsapp, SiInstagram, SiFacebook, SiGmail } from "react-icons/si";
import { useModules } from "@/lib/platform";

export type ReportChannel = "whatsapp" | "instagram" | "facebook" | "email";

export const REPORT_CHANNELS: readonly ReportChannel[] = ["whatsapp", "instagram", "facebook", "email"];

export const CHANNEL_META: Record<ReportChannel, { color: string; label: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }> = {
  whatsapp: { color: "#25D366", label: "WhatsApp", Icon: SiWhatsapp },
  instagram: { color: "#E1306C", label: "Instagram", Icon: SiInstagram },
  facebook: { color: "#1877F2", label: "Facebook", Icon: SiFacebook },
  email: { color: "#EA4335", label: "Correo", Icon: SiGmail },
};

/**
 * Los canales que el reporte muestra: los que esta instancia tiene encendidos,
 * más cualquiera apagado que aun así tuvo conversaciones en el periodo.
 */
export function useReportChannels(rows: { channel: string; conversations: number }[] = []): ReportChannel[] {
  const modules = useModules();
  return REPORT_CHANNELS.filter(
    (channel) => modules[channel] || rows.some((r) => r.channel === channel && r.conversations > 0),
  );
}
