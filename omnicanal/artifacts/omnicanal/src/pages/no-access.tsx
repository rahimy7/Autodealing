import { useLocation } from "wouter";
import { LockKeyhole, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { endServerSession } from "@/lib/presence";

// Quien llega aquí inició sesión bien, pero ninguna de las vistas que tiene
// asignadas está disponible en esta instancia (o no tiene ninguna).
export default function NoAccessPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const leave = async () => {
    await endServerSession();
    logout();
    setLocation("/login");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <LockKeyhole className="w-6 h-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-foreground">No tienes vistas asignadas</h1>
            <p className="text-sm text-muted-foreground">
              {user?.name ? `${user.name}, tu` : "Tu"} usuario no tiene ninguna pantalla disponible en este panel. Pídele a un
              administrador que te asigne acceso desde Administración.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => void leave()} data-testid="button-no-access-logout">
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
