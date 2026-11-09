import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import authRouter from "./auth";
import contactsRouter from "./contacts";
import agentsRouter from "./agents";
import conversationsRouter from "./conversations";
import campaignsRouter from "./campaigns";
import labelsRouter from "./labels";
import workflowsRouter from "./workflows";
import knowledgeBasesRouter from "./knowledge-bases";
import appointmentsRouter from "./appointments";
import productsRouter from "./products";
import customMessagesRouter from "./custom-messages";
import groupsRouter from "./groups";
import planRouter from "./plan";
import analyticsRouter from "./analytics";
import settingsRouter from "./settings";
import logsRouter from "./logs";
import webhooksRouter from "./webhooks";
import mediaRouter from "./media";
import feedRouter from "./feed";
import emailRouter from "./email";
import gmailOAuthRouter from "./gmail-oauth";
import pushRouter from "./push";
import platformRouter from "./platform";
import exchangeRatesRouter from "./exchange-rates";
import ordersRouter from "./orders";
import casesRouter from "./cases";
import agentLessonsRouter from "./agent-lessons";
import answerTrainingRouter from "./answer-training";
import inventoryRouter from "./inventory";
import shipmentsRouter from "./shipments";
import returnsRouter from "./returns";
import purchasingRouter from "./purchasing";
import shopifyRouter from "./shopify";
import uspsRouter from "./usps";
import shopifyLabelsRouter from "./shopify-labels";
import subscriptionsRouter from "./subscriptions";
import viewAccessRouter from "./view-access";
import { requireAuth, viewGatedPaths, requirePlatformAdmin } from "../middlewares/auth";
import { loadViewAccess } from "../middlewares/view-access";
import { checkSubscription } from "../middlewares/subscription";
import { mountModule } from "../lib/client-config";

const router: IRouter = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.use(healthRouter);
router.use(configRouter); // la marca de la instancia, que el login necesita sin sesión
router.use(authRouter); // POST /auth/login is public; GET /auth/me guards itself
router.use(webhooksRouter); // authenticated by Meta's X-Hub-Signature-256 instead
// La vuelta desde la pantalla de permisos de Google no trae la sesión del panel:
// la autoriza el `state` firmado que se entregó a un administrador.
mountModule(router, "email", gmailOAuthRouter);

// ── Platform super-admin (token propio, no usa sesión) ────────────────────────
router.use("/platform-admin", requirePlatformAdmin, platformRouter);

// ── Subscription gate ─────────────────────────────────────────────────────────
router.use(checkSubscription);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.use(requireAuth);
// Qué vistas tiene el usuario (tabla view_access) y, con eso, qué endpoints le
// quedan abiertos: los de las pantallas que no tiene se cierran por prefijo.
router.use(loadViewAccess);
router.use(viewGatedPaths);

// `mountModule` es el gating por cliente: el módulo apagado no monta su router,
// así que sus rutas caen en el 404 JSON de /api. Lo que se monta directo es el
// núcleo que toda instancia tiene (conversaciones, agentes, etiquetas, medios,
// grupos, plan y configuración).
mountModule(router, "crm", contactsRouter);
router.use(agentsRouter);
router.use(viewAccessRouter);
router.use(conversationsRouter);
mountModule(router, "marketing", campaignsRouter);
router.use(mediaRouter);
router.use(labelsRouter);
mountModule(router, "automation", workflowsRouter);
mountModule(router, "knowledgeBases", knowledgeBasesRouter);
mountModule(router, "appointments", appointmentsRouter);
mountModule(router, "orders", ordersRouter);
mountModule(router, "cases", casesRouter);
// Existencias por almacén y los despachos que las descuentan (2026-10-04).
mountModule(router, "inventory", inventoryRouter);
mountModule(router, "inventory", shipmentsRouter);
mountModule(router, "inventory", uspsRouter);
mountModule(router, "inventory", shopifyLabelsRouter);
// Devoluciones y notas de crédito son del pedido: viven con él.
mountModule(router, "orders", returnsRouter);
mountModule(router, "purchasing", purchasingRouter);
// Shopify trae pedidos: vive con Pedidos. Sin credenciales no hace nada.
mountModule(router, "orders", shopifyRouter);
// Los suscriptores de Shopify, también con Pedidos (2026-10-06).
mountModule(router, "orders", subscriptionsRouter);
// La memoria de aprendizaje es de los agentes de IA: sin ellos no hay qué aprender.
mountModule(router, "aiAgents", agentLessonsRouter);
// Entrenar respuestas: el equipo corrige y aprueba cómo responden los agentes.
mountModule(router, "aiAgents", answerTrainingRouter);
// Not in VIEW_GATES: human agents consult the catalog to share product
// links while chatting with a customer.
mountModule(router, "catalog", productsRouter);
mountModule(router, "customMessages", customMessagesRouter);
router.use(groupsRouter);
router.use(planRouter);
mountModule(router, "analytics", analyticsRouter);
router.use(settingsRouter);
// Los errores del servidor no son un módulo que se venda: toda instancia los
// registra y su administrador tiene que poder verlos.
router.use(logsRouter);
// La tasa del día: sin credenciales del banco en la instancia responde que no
// está configurada, así que no hace falta un módulo que la apague.
router.use(exchangeRatesRouter);
mountModule(router, "feed", feedRouter);
mountModule(router, "email", emailRouter);
// Both roles register their phone: agents get their own chats, admins get the
// ones nobody is handling.
mountModule(router, "mobilePush", pushRouter);

export default router;
