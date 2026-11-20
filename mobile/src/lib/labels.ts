export const KIND: Record<string, string> = { testdrive: "Prueba de manejo", visit: "Visita", delivery: "Entrega", call: "Llamada", followup: "Seguimiento", service: "Servicio / taller" };
export const APPT_STATUS: Record<string, string> = { pending: "Por confirmar", confirmed: "Confirmada", completed: "Completada", no_show: "No asistió", cancelled: "Cancelada" };
export const APPT_TONE: Record<string, Tone> = { pending: "warn", confirmed: "info", completed: "ok", no_show: "bad", cancelled: "neutral" };
export const HOLD_STATUS: Record<string, string> = { active: "Activa", released: "Liberada", expired: "Vencida", converted: "Vendida" };
export const HOLD_TONE: Record<string, Tone> = { active: "warn", released: "neutral", expired: "bad", converted: "ok" };
export const VEHICLE_STATUS: Record<string, string> = { draft: "En revisión", available: "Disponible", reserved: "Reservado", sold: "Vendido", archived: "Archivado" };
export const VEHICLE_TONE: Record<string, Tone> = { draft: "violet", available: "ok", reserved: "warn", sold: "info", archived: "neutral" };
export const LEAD_KIND: Record<string, string> = { testdrive: "Prueba de manejo", trade: "Intercambio", contact: "Contacto", finance: "Financiamiento", visit: "Cita" };
export const LEAD_DETAILS: [string, string][] = [["topic", "Motivo"], ["down", "Inicial"], ["employment", "Empleo"], ["income", "Ingreso"], ["credit", "Crédito"]];
export const LEAD_STATUS: Record<string, string> = { new: "Nueva", contacted: "Contactada", closed: "Cerrada" };
export const CHANNEL: Record<string, [string, Tone]> = { whatsapp: ["WhatsApp", "wa"], instagram: ["Instagram", "ig"], facebook: ["Facebook", "fb"] };
export const CONVO_STATUS: Record<string, string> = { open: "Abierta", pending: "En espera", bot: "IA atendiendo", resolved: "Resuelta" };
export const BODIES: [string, string][] = [["suv", "SUV"], ["sedan", "Sedán"], ["truck", "Pickup"], ["coupe", "Coupé"], ["hatch", "Hatchback"], ["van", "Minivan"], ["electric", "Eléctrico"]];
export const CONDITIONS: [string, string][] = [["used", "Usado"], ["new", "Nuevo"], ["certified", "Certificado"]];
export const FUELS: [string, string][] = [["gas", "Gasolina"], ["diesel", "Diésel"], ["hybrid", "Híbrido"], ["electric", "Eléctrico"]];
export const DURATIONS: [string, string][] = [["30", "30 min"], ["45", "45 min"], ["60", "1 hora"], ["90", "1 h 30"], ["120", "2 horas"], ["180", "3 horas"], ["240", "4 horas"]];
export const ROLE_LABEL: Record<string, string> = { admin: "Administración", sales: "Ventas", service: "Servicio" };
export const ROLE_HELP: Record<string, string> = {
  sales: "Catálogo, cotizaciones, reservas, ventas, agenda, consultas web y sus chats. Carga unidades y fotos.",
  service: "Catálogo para consultar y compartir, agenda de servicio, sus chats y carga de unidades y fotos. No reserva, cotiza ni vende.",
  admin: "Todo: precios y publicación, equipo, finanzas, Omnicanal y la página.",
};
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "violet" | "wa" | "ig" | "fb";
