import {
  Headphones,
  ShoppingBag,
  Calendar,
  Filter as FilterIcon,
  Wand2,
  RefreshCw,
  Gauge,
  Sparkles,
  UserCheck,
  RotateCcw,
  PackageCheck,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook, SiGmail } from "react-icons/si";

export const STATUS_STYLES: Record<string, string> = {
  online: "text-green-500",
  busy: "text-amber-500",
  offline: "text-muted-foreground/60",
};

export const STATUS_LABELS: Record<string, string> = {
  online: "En línea",
  busy: "Ocupado",
  offline: "Desconectado",
};

// Background colour for the little presence dot.
export const STATUS_DOTS: Record<string, string> = {
  online: "bg-green-500 animate-pulse",
  busy: "bg-amber-500",
  offline: "bg-gray-400",
};

export const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  facebook: SiFacebook,
  email: SiGmail,
};

export const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
  email: "text-[#EA4335]",
};

export const ALL_CHANNELS = ["whatsapp", "instagram", "facebook", "email"] as const;

export const PROFILE_TEMPLATES = [
  { id: "sales", name: "Ventas", icon: ShoppingBag, color: "from-pink-500 to-rose-500", description: "Asesora, recomienda productos y cierra ventas", suggestedName: "Sofía Ventas IA", suggestedEmail: "ventas-ia@decolor.com" },
  { id: "support", name: "Atención al Cliente", icon: Headphones, color: "from-cyan-500 to-blue-500", description: "Responde dudas, gestiona quejas y soporte", suggestedName: "Lucía Soporte IA", suggestedEmail: "soporte-ia@decolor.com" },
  { id: "reservations", name: "Reservas y Agenda", icon: Calendar, color: "from-purple-500 to-fuchsia-500", description: "Agenda citas, visitas y confirmaciones", suggestedName: "Mateo Agenda IA", suggestedEmail: "agenda-ia@decolor.com" },
  { id: "qualifier", name: "Calificador de Leads", icon: FilterIcon, color: "from-amber-500 to-orange-500", description: "Filtra prospectos y entrega leads listos", suggestedName: "Kai Calificador IA", suggestedEmail: "leads-ia@decolor.com" },
  { id: "general", name: "Asistente General", icon: Wand2, color: "from-emerald-500 to-teal-500", description: "Conversación general, deriva cuando hace falta", suggestedName: "Aria Asistente IA", suggestedEmail: "asistente-ia@decolor.com" },
  // Proactivos: no atienden chats nuevos, escriben desde un disparador del workflow.
  { id: "winback", name: "Ventas · Recuperación", icon: RotateCcw, color: "from-fuchsia-500 to-pink-500", description: "Retoma los chats que cerraron sin venta (disparador del workflow)", suggestedName: "Valeria Ventas IA", suggestedEmail: "recuperacion-ia@decolor.com" },
  { id: "postsale", name: "Post-venta", icon: PackageCheck, color: "from-indigo-500 to-violet-500", description: "Confirma la entrega, mide la satisfacción y promueve la recompra", suggestedName: "Camila Post-venta IA", suggestedEmail: "postventa-ia@decolor.com" },
] as const;

export function profileTemplate(id: string | null | undefined) {
  return PROFILE_TEMPLATES.find((p) => p.id === id) ?? null;
}

// Group distribution rules — labels/help shown in the Groups UI.
export const DISTRIBUTION_RULES = [
  { id: "round_robin", label: "Round-robin", icon: RefreshCw, description: "Reparte por turnos rotativos entre los miembros." },
  { id: "least_busy", label: "Menos ocupado", icon: Gauge, description: "Asigna al miembro con menos conversaciones activas." },
  { id: "by_capability", label: "Por capacidad", icon: Sparkles, description: "Dirige según las capacidades que coinciden con la etiqueta." },
  { id: "manual", label: "Manual", icon: UserCheck, description: "Deja la conversación en cola para que un supervisor la asigne." },
] as const;

export type DistributionRuleId = (typeof DISTRIBUTION_RULES)[number]["id"];

// Structured capability fields — categories group a skill and sharpen the
// "by capability" routing; levels describe the agent's proficiency.
export const CAPABILITY_CATEGORIES = [
  { id: "producto", label: "Producto" },
  { id: "ventas", label: "Ventas" },
  { id: "soporte", label: "Soporte" },
  { id: "proceso", label: "Proceso" },
  { id: "general", label: "General" },
] as const;

export const CAPABILITY_LEVELS = [
  { id: "básico", label: "Básico" },
  { id: "intermedio", label: "Intermedio" },
  { id: "experto", label: "Experto" },
] as const;
