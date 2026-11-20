import { useState } from "react";
import { Menu, Zap } from "lucide-react";
import Sidebar, { SidebarInner } from "./Sidebar";
import { useClient } from "@/lib/platform";
import { usePresenceHeartbeat } from "@/lib/presence";
import { useChatNotifications } from "@/lib/notifications";
import HandoffRibbon from "@/components/HandoffRibbon";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { EMBEDDED } from "@/lib/embed";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [open, setOpen] = useState(false);
  const { branding } = useClient();
  // Admins backed by an agent row appear in the same roster, so they announce
  // themselves too. No-op for the environment administrator (no agent row).
  usePresenceHeartbeat();
  useChatNotifications();
  // Dentro de la administración del sitio el menú es el de la administración: aquí
  // solo va la pantalla.
  if (EMBEDDED) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <HandoffRibbon />
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    );
  }
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        {/* Lleva el fondo del menú, así que el texto también tiene que ser el del
            menú: con el de la página, un menú oscuro dejaba el título ilegible. */}
        <header className="md:hidden flex items-center gap-3 px-4 h-14 border-b border-sidebar-border bg-sidebar text-sidebar-foreground flex-shrink-0">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="p-2 -ml-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent" data-testid="button-open-sidebar" aria-label="Abrir menú">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 border-sidebar-border [&>button]:hidden">
              <SidebarInner onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-sidebar-primary-foreground" strokeWidth={2.5} />
            </div>
            <span className="text-sm font-bold text-sidebar-foreground truncate">{branding.productName}</span>
          </div>
        </header>
        {/* Chats waiting for a human, announced the same way an agent gets theirs. */}
        <HandoffRibbon />
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    </div>
  );
}
