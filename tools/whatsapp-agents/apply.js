// Creates Premier's WhatsApp virtual agents, knowledge bases, intent labels and workflow in
// Omnicanal, through Omnicanal's own API (so every validation applies).
//
//   node --env-file=.env tools/whatsapp-agents/apply.js
//
// It runs against the database in DATABASE_URL (production's, when .env points there) and refuses
// to run when Omnicanal already has agents, labels, workflows or knowledge bases: it never
// overwrites or duplicates what someone has set up. The AI key is not needed to create them.
import { SALES_PROMPT, SCHEDULER_PROMPT, DEALER_KB, LABELS, WELCOME } from "./spec.js";

const { omniConfigured, omniConfigError, systemIdentity, omniRequest, syncInventory } = await import("../../server/omni-service.js");
if (!omniConfigured()) {
  console.error("Omnicanal is not configured: " + omniConfigError());
  process.exit(1);
}
const identity = await systemIdentity();
const oc = (path, options) => omniRequest(identity, path, options);

const created = {};
try {
  // 0. Nothing to overwrite.
  for (const path of ["/agents", "/labels", "/workflows", "/knowledge-bases", "/custom-messages"]) {
    const list = await oc(path);
    if (list.length) throw new Error(`${path} already has ${list.length} item(s): not creating duplicates.`);
  }

  // 1. Dealership knowledge base.
  const kb = await oc("/knowledge-bases", {
    method: "POST",
    body: {
      name: "Datos del concesionario",
      description: "Dirección, teléfono, cómo se agenda y cómo funciona el financiamiento, solo con lo que el concesionario ha publicado. Edítala aquí si cambia.",
      content: DEALER_KB,
    },
  });
  created.dealerKb = kb.id;
  console.log("KB datos del concesionario:", kb.id);

  // 2. Intent labels.
  const labelId = {};
  for (const l of LABELS) {
    const r = await oc("/labels", { method: "POST", body: { name: l.name, kind: "intent", color: l.color, description: l.description, isActive: true } });
    labelId[l.key] = r.id;
    console.log("label", l.name, "->", r.id);
  }
  created.labels = labelId;

  // 3. Agents. The sales agent goes first: the lowest id is the default for any unassigned chat.
  const sales = await oc("/agents", {
    method: "POST",
    body: {
      name: "Asistente de ventas (IA)",
      email: "ia-ventas@premier.invalid",
      type: "virtual",
      channels: ["whatsapp"],
      profileType: "sales",
      systemPrompt: SALES_PROMPT,
    },
  });
  console.log("agent ventas ->", sales.id, "model", sales.model);
  const scheduler = await oc("/agents", {
    method: "POST",
    body: {
      name: "Asistente de citas (IA)",
      email: "ia-citas@premier.invalid",
      type: "virtual",
      channels: ["whatsapp"],
      profileType: "reservations",
      systemPrompt: SCHEDULER_PROMPT,
      // Prices, financing and vehicle questions are not the scheduler's: they pass, silently, to sales.
      escalateToAgentId: sales.id,
    },
  });
  console.log("agent citas  ->", scheduler.id, "escalates to", scheduler.escalateToAgentId);
  created.agents = { sales: sales.id, scheduler: scheduler.id };

  // 4. The inventory knowledge base is written by the site (the same code production runs on every
  // inventory change). Links appear once the site knows its public address (Administración →
  // Omnicanal → "Dirección pública del sitio", or "Sincronizar ahora" in the same screen).
  const sync = await syncInventory(process.env.PUBLIC_BASE_URL || "");
  created.inventoryKb = sync.knowledgeBaseId;
  console.log("KB inventario:", sync.knowledgeBaseId, `(${sync.lastSyncCount} units)`);

  // 5. Capabilities: what each agent is for, and which knowledge it reads.
  const cap = (agentId, body) => oc(`/agents/${agentId}/capabilities`, { method: "POST", body });
  await cap(sales.id, {
    name: "Inventario de vehículos",
    description: "Recomienda y responde sobre las unidades disponibles y reservadas: año, marca, modelo, millaje, características y precio cuando está publicado.",
    knowledgeBaseId: sync.knowledgeBaseId,
    category: "producto",
    level: "experto",
    keywords: ["SUV", "sedán", "pickup", "minivan", "camioneta", "precio", "millas", "disponible", "inventario", "carro", "vehículo"],
    examples: "¿Tienen alguna SUV? · ¿Qué precio tiene el Explorer? · Do you have a truck?",
  });
  await cap(sales.id, {
    name: "Datos y proceso de compra",
    description: "Dirección, teléfono, correo, cómo agendar una visita, cómo funciona el financiamiento y el intercambio (sin prometer aprobaciones ni valores).",
    knowledgeBaseId: kb.id,
    category: "ventas",
    level: "intermedio",
    keywords: ["dirección", "teléfono", "horario", "financiamiento", "crédito", "intercambio", "trade-in", "ITIN"],
    examples: "¿Dónde están? · ¿Cómo funciona el financiamiento? · ¿Aceptan mi carro?",
  });
  await cap(scheduler.id, {
    name: "Citas y pruebas de manejo",
    description: "Agenda visitas y pruebas de manejo de lunes a sábado. Cada cita queda como solicitud y un asesor la confirma.",
    knowledgeBaseId: kb.id,
    category: "proceso",
    level: "experto",
    keywords: ["cita", "visita", "prueba de manejo", "test drive", "agendar", "sábado"],
    examples: "Quiero probarlo el sábado a las 11:30 · Can I come tomorrow afternoon?",
  });

  // 6. Workflow: intent → agent. Every label ends at a handling node.
  const node = (id, x, y, data) => ({ id, type: "flow", position: { x, y }, data });
  const edge = (a, b) => ({ id: `e-${a}-${b}`, source: a, target: b });
  const graph = {
    nodes: [
      node("start", 0, 160, { kind: "start", title: "Mensaje de WhatsApp" }),
      node("lbl-inventory", 280, 20, { kind: "label", labelId: labelId.inventory, title: "Inventario y compra" }),
      node("lbl-finance", 280, 160, { kind: "label", labelId: labelId.finance, title: "Financiamiento y pagos" }),
      node("lbl-appointment", 280, 300, { kind: "label", labelId: labelId.appointment, title: "Citas y pruebas de manejo" }),
      node("agent-sales", 580, 90, { kind: "agent", agentId: sales.id, title: "Asistente de ventas (IA)" }),
      node("agent-scheduler", 580, 300, { kind: "agent", agentId: scheduler.id, title: "Asistente de citas (IA)" }),
    ],
    edges: [
      edge("start", "lbl-inventory"),
      edge("start", "lbl-finance"),
      edge("start", "lbl-appointment"),
      edge("lbl-inventory", "agent-sales"),
      edge("lbl-finance", "agent-sales"),
      edge("lbl-appointment", "agent-scheduler"),
    ],
  };
  const wf = await oc("/workflows", { method: "POST", body: { name: "WhatsApp · ventas y citas", channels: ["whatsapp"], isActive: true, graph } });
  created.workflow = wf.id;
  console.log("workflow ->", wf.id, "active:", wf.isActive);

  // 7. The default welcome message, with its picture and buttons. Active: it is what a new
  // WhatsApp conversation that opens with a bare greeting receives.
  const welcome = await oc("/custom-messages", { method: "POST", body: { kind: "welcome", ...WELCOME } });
  await oc(`/custom-messages/${welcome.id}/activate`, { method: "POST", body: { isActive: true } });
  created.welcome = welcome.id;
  console.log("welcome ->", welcome.id, "(active)");
  console.log("\nCREATED:", JSON.stringify(created));
} catch (error) {
  console.log("\nSTOPPED:", error.message);
  console.log("created so far:", JSON.stringify(created));
  process.exitCode = 1;
} finally {
  await (await import("../../server/db.js")).pool.end();
}
