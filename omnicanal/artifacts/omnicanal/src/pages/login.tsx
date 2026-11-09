import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { Zap, ArrowRight, Loader2 } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import { useAuth, homePathFor } from "@/lib/auth";
import { useClient, useModules, usePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/base-path";

const CHANNEL_PITCH = {
  whatsapp: {
    icon: SiWhatsapp,
    label: "WhatsApp Business API · Mensajes 1:1 y campañas masivas",
    color: "text-[#25D366]",
    name: "WhatsApp",
  },
  instagram: {
    icon: SiInstagram,
    label: "Instagram DM · DMs, comentarios y respuestas automáticas",
    color: "text-[#E1306C]",
    name: "Instagram",
  },
  facebook: {
    icon: SiFacebook,
    label: "Facebook Messenger · API oficial de Meta",
    color: "text-[#1877F2]",
    name: "Facebook",
  },
} as const;

// Dentro del sitio de Premier el panel se abre con la cuenta del sitio: esta es la
// dirección que firma la sesión (server/index.js, /omnicanal/entrar). Solo existe
// cuando se compila para el sitio (VITE_SITE_LOGIN_URL); como servicio propio el
// login es solo el formulario.
const SITE_LOGIN_URL: string | undefined = import.meta.env.VITE_SITE_LOGIN_URL || undefined;

/** "WhatsApp, Instagram y Facebook" — solo los canales de esta instancia. */
function joinChannelNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "tus canales";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { branding, business } = useClient();
  const { channels } = usePlatform();
  const modules = useModules();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await loginMutation.mutateAsync({ data: { email, password } });
      login(result.token, result.user);
      // Cada quien entra a la primera vista que tiene asignada, no a la de su rol.
      setLocation(homePathFor(result.user.views, (module) => modules[module]));
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? "Correo o contraseña incorrectos."
          : "No se pudo iniciar sesión. Intenta de nuevo.",
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-8 items-center">
        {/* Marketing pane */}
        <div className="hidden md:block px-4">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30 overflow-hidden">
              {branding.logoUrl ? (
                <img src={withBase(branding.logoUrl)} alt={branding.productName} className="w-full h-full object-contain" />
              ) : (
                <Zap className="w-6 h-6 text-primary-foreground" strokeWidth={2.5} />
              )}
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground tracking-tight">{branding.productName}</div>
              <div className="text-xs text-muted-foreground">{branding.tagline}</div>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-foreground tracking-tight leading-tight mb-4">
            Toda tu atención al cliente, <span className="text-primary">en un solo lugar.</span>
          </h1>
          <p className="text-base text-muted-foreground mb-8 leading-relaxed">
            Gestiona {joinChannelNames(channels.map((channel) => CHANNEL_PITCH[channel].name))} con IA, agentes
            humanos y automatizaciones inteligentes.
          </p>

          <div className="space-y-3">
            {channels.map((channel) => {
              const { icon: Icon, label, color } = CHANNEL_PITCH[channel];
              return (
                <div key={channel} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-card-border">
                  <Icon className={cn("w-5 h-5", color)} />
                  <span className="text-sm text-foreground/80">{label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-8 p-4 rounded-xl bg-primary/5 border border-primary/20">
            <div className="text-xs font-semibold text-primary mb-1">{business.displayName}</div>
            <div className="text-xs text-muted-foreground">Servicio operado por <a href="https://www.rvrservice.com" className="text-primary hover:underline">RVR Service</a></div>
          </div>
        </div>

        {/* Login card */}
        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-xl">
          <div className="md:hidden flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className="text-xl font-bold text-foreground">{branding.productName}</div>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-1">Iniciar sesión</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {SITE_LOGIN_URL
              ? `Entra con tu usuario de ${business.displayName}, o con un correo y contraseña de este panel.`
              : "Entra con tu correo y contraseña. Tu rol se asigna automáticamente."}
          </p>

          {SITE_LOGIN_URL && (
            <>
              <a
                href={SITE_LOGIN_URL}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors"
                data-testid="link-site-login"
              >
                Entrar con mi usuario de {business.displayName}
                <ArrowRight className="w-4 h-4" />
              </a>
              <div className="flex items-center gap-3 my-6 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />o con correo y contraseña
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1.5">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="tucorreo@ejemplo.com"
                autoComplete="username"
                data-testid="input-email"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1.5">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="••••••••"
                autoComplete="current-password"
                data-testid="input-password"
                required
              />
            </div>

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2" data-testid="login-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-sm transition-colors shadow-md shadow-primary/20",
                loginMutation.isPending && "opacity-60",
              )}
              data-testid="button-login"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Entrando…
                </>
              ) : (
                <>
                  Entrar <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              ¿Eres agente y no tienes contraseña? Pídele al administrador que te la asigne.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
