import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, homePathFor, AGENT_HOME } from "@/lib/auth";
import { PlatformProvider, useModules } from "@/lib/platform";
import { VIEWS, homeViewFor, type ModuleKey, type ViewKey } from "@workspace/platform-config";
import NotFound from "@/pages/not-found";
import NoAccessPage from "@/pages/no-access";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import InboxPage from "@/pages/inbox";
import ContactsPage from "@/pages/contacts";
import ContactDetailPage from "@/pages/contact-detail";
import CampaignsPage from "@/pages/campaigns";
import WorkflowPage from "@/pages/workflow";
import WorkflowEditorPage from "@/pages/workflow-editor";
import ProductsPage from "@/pages/products";
import CustomMessagesPage from "@/pages/custom-messages";
import AgentsPage from "@/pages/agents";
import AgentEditorPage from "@/pages/agent-editor";
import AdminPage from "@/pages/admin";
import PlatformPortal from "@/pages/platform-portal";
import ReportsPage from "@/pages/reports";
import MonitorPage from "@/pages/monitor";
import LogsPage from "@/pages/logs";
import SettingsPage from "@/pages/settings";
import FeedPage from "@/pages/feed";
import EmailPage from "@/pages/email";
import AppointmentsPage from "@/pages/appointments";
import OrdersPage from "@/pages/orders";
import SubscriptionsPage from "@/pages/subscriptions";
import CasesPage from "@/pages/cases";
import InventoryPage from "@/pages/inventory";
import ShipmentsPage from "@/pages/shipments";
import PurchasingPage from "@/pages/purchasing";
import LearningPage from "@/pages/learning";
import AnswerTrainingPage from "@/pages/answer-training";
import AgentInbox from "@/pages/agent/agent-inbox";
import AgentChats from "@/pages/agent/agent-chats";
import AgentProfile from "@/pages/agent/agent-profile";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function Protected({
  component: Component,
  view,
  module,
}: {
  component: React.ComponentType;
  /** Vista que el usuario necesita tener asignada (tabla view_access), sea cual sea su rol. */
  view: ViewKey;
  /** Módulo que esta pantalla necesita. Sin él, la ruta no existe para la instancia. */
  module?: ModuleKey;
}) {
  const { user, views, viewsLoaded } = useAuth();
  const modules = useModules();
  const [, setLocation] = useLocation();
  const allowed = views.has(view);

  useEffect(() => {
    if (!user) {
      setLocation("/login");
    } else if (viewsLoaded && !allowed) {
      // A su casa, no a un 404: una vista que le quitaron mientras la tenía abierta
      // lo devuelve a lo que sí puede ver.
      setLocation(homePathFor(views, (m) => modules[m]));
    }
  }, [user, viewsLoaded, allowed, views, modules, setLocation]);

  // Una sesión vieja espera a que el servidor le diga sus vistas antes de decidir.
  if (!user || !viewsLoaded || !allowed) return null;
  // El menú ya no ofrece la sección, pero un enlace guardado o una URL escrita a
  // mano sí llegan aquí: sin este corte, la pantalla se montaría y pediría un
  // endpoint que en esta instancia no existe.
  if (module && !modules[module]) return <NotFound />;
  return <Component />;
}

function HomeRedirect() {
  const { user, views, viewsLoaded } = useAuth();
  const modules = useModules();
  if (!user) return <Redirect to="/login" />;
  if (!viewsLoaded) return null;
  const home = homeViewFor(views, (m) => modules[m]);
  if (home === "dashboard") return <Dashboard />;
  if (home) return <Redirect to={VIEWS[home].path} />;
  return <NoAccessPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      {/* Agent routes. Cada ruta pide su vista (tabla view_access), no un rol: el
          agente de servicio arranca con estas tres —sus chats, el Chat General y
          su perfil para cambiar la contraseña— y a cualquiera se le pueden dar
          otras desde Administración. Mi Panel y Catálogo se redirigen en vez de
          existir, para que un enlace guardado o una URL escrita a mano tampoco
          abran una pantalla que su menú ya no ofrece. Devolverle alguna es volver
          a poner aquí su <Route> y su import. */}
      <Route path="/agent/inbox">{() => <Protected component={AgentInbox} view="my-chats" />}</Route>
      <Route path="/agent/chats">{() => <Protected component={AgentChats} view="general-chat" />}</Route>
      <Route path="/agent/profile">{() => <Protected component={AgentProfile} view="my-profile" />}</Route>
      <Route path="/agent">{() => <Redirect to={AGENT_HOME} />}</Route>
      <Route path="/agent/products">{() => <Redirect to={AGENT_HOME} />}</Route>

      {/* Resto del panel: igual, cada ruta pide su vista. */}
      <Route path="/" component={HomeRedirect} />
      <Route path="/inbox">{() => <Protected component={InboxPage} view="inbox" module="inbox" />}</Route>
      <Route path="/contacts">{() => <Protected component={ContactsPage} view="contacts" module="crm" />}</Route>
      <Route path="/contacts/:id">{() => <Protected component={ContactDetailPage} view="contacts" module="crm" />}</Route>
      <Route path="/campaigns">{() => <Protected component={CampaignsPage} view="campaigns" module="marketing" />}</Route>
      <Route path="/products">{() => <Protected component={ProductsPage} view="products" module="catalog" />}</Route>
      <Route path="/custom-messages">{() => <Protected component={CustomMessagesPage} view="custom-messages" module="customMessages" />}</Route>
      <Route path="/workflow">{() => <Protected component={WorkflowPage} view="workflow" module="automation" />}</Route>
      <Route path="/workflow/:id">{() => <Protected component={WorkflowEditorPage} view="workflow" module="automation" />}</Route>
      <Route path="/agents">{() => <Protected component={AgentsPage} view="agents" />}</Route>
      <Route path="/agents/:id">{() => <Protected component={AgentEditorPage} view="agents" />}</Route>
      <Route path="/admin">{() => <Protected component={AdminPage} view="admin" />}</Route>
      <Route path="/logs">{() => <Protected component={LogsPage} view="logs" />}</Route>
      <Route path="/reports">{() => <Protected component={ReportsPage} view="reports" module="analytics" />}</Route>
      <Route path="/monitor">{() => <Protected component={MonitorPage} view="monitor" module="monitor" />}</Route>
      <Route path="/settings">{() => <Protected component={SettingsPage} view="settings" />}</Route>
      <Route path="/feed">{() => <Protected component={FeedPage} view="feed" module="feed" />}</Route>
      <Route path="/email">{() => <Protected component={EmailPage} view="email" module="email" />}</Route>
      <Route path="/appointments">{() => <Protected component={AppointmentsPage} view="appointments" module="appointments" />}</Route>
      <Route path="/orders">{() => <Protected component={OrdersPage} view="orders" module="orders" />}</Route>
      <Route path="/subscriptions">{() => <Protected component={SubscriptionsPage} view="subscriptions" module="orders" />}</Route>
      <Route path="/cases">{() => <Protected component={CasesPage} view="cases" module="cases" />}</Route>
      <Route path="/inventory">{() => <Protected component={InventoryPage} view="inventory" module="inventory" />}</Route>
      <Route path="/shipments">{() => <Protected component={ShipmentsPage} view="shipments" module="inventory" />}</Route>
      <Route path="/purchasing">{() => <Protected component={PurchasingPage} view="purchasing" module="purchasing" />}</Route>
      <Route path="/learning">{() => <Protected component={LearningPage} view="learning" module="aiAgents" />}</Route>
      <Route path="/answer-training">{() => <Protected component={AnswerTrainingPage} view="answer-training" module="aiAgents" />}</Route>

      {/* Portal de plataforma: token propio, no necesita sesión de admin */}
      <Route path="/platform" component={PlatformPortal} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Fuera de AuthProvider: la marca de la instancia se aplica también en el
          login, antes de que haya sesión. */}
      <PlatformProvider>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </PlatformProvider>
    </QueryClientProvider>
  );
}

export default App;
