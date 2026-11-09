import {
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  User,
  Users,
  Megaphone,
  Workflow,
  UserCog,
  Settings,
  ShieldCheck,
  Activity,
  BarChart3,
  MessageCircle,
  Package,
  ClipboardList,
  FolderOpen,
  MessageSquarePlus,
  CalendarDays,
  Building2,
  AlertTriangle,
  Mail,
  Brain,
  GraduationCap,
  Boxes,
  Truck,
  ShoppingCart,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { VIEW_KEYS, VIEWS, type ViewKey } from "@workspace/platform-config";
import { useAuth } from "@/lib/auth";
import { useClient, useModules } from "@/lib/platform";

// Lo que el catálogo de vistas (@workspace/platform-config) no sabe: con qué ícono
// se pinta cada una en el menú. Un Record completo, para que agregar una vista al
// catálogo sin ícono no compile.
export const VIEW_ICONS: Record<ViewKey, LucideIcon> = {
  "my-chats": MessageSquare,
  "general-chat": MessagesSquare,
  "my-profile": User,
  dashboard: LayoutDashboard,
  inbox: MessageSquare,
  feed: MessageCircle,
  email: Mail,
  appointments: CalendarDays,
  orders: ClipboardList,
  subscriptions: Repeat,
  shipments: Truck,
  inventory: Boxes,
  purchasing: ShoppingCart,
  cases: FolderOpen,
  learning: Brain,
  "answer-training": GraduationCap,
  monitor: Activity,
  reports: BarChart3,
  contacts: Users,
  campaigns: Megaphone,
  products: Package,
  "custom-messages": MessageSquarePlus,
  workflow: Workflow,
  agents: UserCog,
  admin: ShieldCheck,
  logs: AlertTriangle,
  settings: Settings,
  platform: Building2,
};

export interface NavEntry {
  key: ViewKey;
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Las entradas del menú de quien tiene sesión: las vistas que se le asignaron
 * (tabla view_access) y cuyo módulo la instancia tiene encendido, en el orden del
 * catálogo. Es la misma lista para el menú del administrador y el del agente: lo
 * que cambia es qué vistas tiene cada quien, no qué menú le toca.
 */
export function useNavEntries(): NavEntry[] {
  const { views } = useAuth();
  const modules = useModules();
  const church = useClient().id === "linaje-real";
  return VIEW_KEYS.filter((key) => {
    const module = VIEWS[key].module;
    return views.has(key) && (!module || modules[module]);
  }).map((key) => ({ key, href: VIEWS[key].path, label: church && key === "cases" ? "Peticiones" : VIEWS[key].label, icon: VIEW_ICONS[key] }));
}

/** Si el usuario tiene la vista asignada (el módulo de la instancia no se mira aquí). */
export function useHasView(key: ViewKey): boolean {
  return useAuth().views.has(key);
}
