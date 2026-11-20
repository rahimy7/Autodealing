// The Omnicanal integration as this site uses it: identities, settings and the data kept in sync.
// Every call is best effort from the site's point of view: a sale, reservation or appointment is
// saved here first, and an Omnicanal outage only leaves a note to retry.
import { query } from "./db.js";
import { InputError, phoneDigits } from "./domain.js";
import {
  OmniError,
  omniConfig,
  createClient,
  inventoryKnowledge,
  vehicleTitle,
  EMBED_PREFIX,
} from "./omnicanal.js";

// The dealership's wall clock (defined with the work hours, which use it too).
import { DEALER_TZ } from "./work-hours.js";
export { DEALER_TZ };

let config = null,
  configError = null;
try {
  config = omniConfig();
} catch (error) {
  configError = error.message;
  console.error("Omnicanal integration disabled:", error.message);
}
const client = config ? createClient(config) : null;

export const omniConfigured = () => Boolean(client);
export const omniConfigError = () => configError;
// Omnicanal running inside this service (server/omni-embed.js), or null.
export const omniEmbedded = () => (config?.embedded ? config : null);
// Where administration opens the full Omnicanal panel. Inside this service it is on this same
// domain and opens with the site's own session.
export const omniPanelUrl = () => (config?.embedded ? `${EMBED_PREFIX}/entrar` : config?.url || "");
let embeddedState = null;
export const attachEmbedded = (state) => (embeddedState = state);

function ensure() {
  if (!client)
    throw new InputError(
      configError
        ? `La integración con Omnicanal está mal configurada: ${configError}`
        : "Omnicanal no está conectado. Administración debe configurar OMNICANAL_URL y OMNICANAL_SESSION_SECRET.",
      503,
    );
  return client;
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  publicUrl: "",
  autoSync: true,
  pushLeads: true,
  knowledgeBaseId: null,
  lastSyncAt: null,
  lastSyncError: null,
  lastSyncCount: 0,
};
export async function omniSettings() {
  const { rows } = await query("SELECT value FROM settings WHERE id='omnicanal'");
  return { ...DEFAULTS, ...rows[0]?.value };
}
export async function saveOmniSettings(patch) {
  await query(
    "INSERT INTO settings(id,value) VALUES('omnicanal',$1) ON CONFLICT(id) DO UPDATE SET value=settings.value || $1",
    [JSON.stringify(patch)],
  );
}
export async function dealerInfo() {
  const { rows } = await query("SELECT value FROM settings WHERE id='dealer'");
  return rows[0]?.value || {};
}

// ── Identities ──────────────────────────────────────────────────────────────────────────────
// The site itself: catalogue, contacts and agenda. It has no agent row in Omnicanal, so it is
// treated as the instance's environment administrator and never takes over a chat.
export async function systemIdentity() {
  const dealer = await dealerInfo();
  return {
    role: "admin",
    name: `${dealer.name || "Concesionario"} · sistema`,
    email: "integracion@sitio-web",
    agentId: null,
  };
}

let agentCache = { at: 0, list: null };
export async function omniAgents(force = false) {
  const api = ensure();
  if (!force && agentCache.list && Date.now() - agentCache.at < 60_000) return agentCache.list;
  const list = await api.request(await systemIdentity(), "/agents");
  agentCache = {
    at: Date.now(),
    list: (Array.isArray(list) ? list : []).filter((a) => a.type === "human"),
  };
  return agentCache.list;
}
export const clearAgentCache = () => (agentCache = { at: 0, list: null });

// A salesperson acts in Omnicanal as the agent administration linked them to. An administrator
// without a link reads and answers as the instance administrator.
export async function identityFor(user, { requireAgent = false } = {}) {
  ensure();
  const { rows } = await query("SELECT omni_agent_id FROM admin_users WHERE id=$1", [user.id]);
  const agentId = rows[0]?.omni_agent_id;
  if (!agentId) {
    if (user.role === "admin" && !requireAgent) return systemIdentity();
    throw new InputError(
      "Tu usuario no está vinculado a un agente de Omnicanal. Administración puede vincularlo en Omnicanal → Equipo.",
      403,
    );
  }
  let agent = (await omniAgents()).find((a) => a.id === agentId);
  if (!agent) agent = (await omniAgents(true)).find((a) => a.id === agentId);
  if (!agent || !agent.isActive)
    throw new InputError("Tu agente de Omnicanal no existe o está desactivado.", 403);
  return {
    role: agent.role === "admin" ? "admin" : "agent",
    name: agent.name,
    email: agent.email || "",
    agentId,
  };
}
export const omniRequest = (identity, path, options) => ensure().request(identity, path, options);

// ── Connection status (cached briefly: the admin page and the sales app both ask) ─────────
let statusCache = { at: 0, value: null };
export async function connectionStatus(force = false) {
  if (!client) return { configured: false, error: configError };
  if (!force && statusCache.value && Date.now() - statusCache.at < 30_000) return statusCache.value;
  let value;
  try {
    const identity = await systemIdentity();
    await client.request(identity, "/auth/me");
    const cfg = await client.request(identity, "/config");
    const names = (v) =>
      Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v).filter((k) => v[k]) : [];
    value = {
      configured: true,
      connected: true,
      instance: {
        name: cfg?.client?.business?.displayName || cfg?.client?.name || "",
        product: cfg?.client?.branding?.productName || "",
        channels: names(cfg?.channels),
        modules: names(cfg?.modules),
        version: cfg?.core?.version || "",
      },
    };
  } catch (error) {
    // Inside this service the process itself says best why it can't answer.
    const local = embeddedState && !embeddedState.running && embeddedState.error;
    value = { configured: true, connected: false, error: local || error.message };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

// ── Contacts ────────────────────────────────────────────────────────────────────────────────
// Matches an existing contact by the last ten digits of the phone, then by email, before
// creating one, so a customer who already wrote on WhatsApp is not duplicated.
export async function upsertContact({ name, phone, email, notes }) {
  const api = ensure();
  const identity = await systemIdentity();
  const digits = phoneDigits(phone).slice(-10);
  if (digits.length >= 7) {
    const found = await api.request(identity, `/contacts?search=${encodeURIComponent(digits)}`);
    const hit = (found || []).find((c) => phoneDigits(c.phone).endsWith(digits));
    if (hit) return hit.id;
  }
  const mail = String(email || "").toLowerCase();
  if (mail) {
    const found = await api.request(identity, `/contacts?search=${encodeURIComponent(mail)}`);
    const hit = (found || []).find((c) => String(c.email || "").toLowerCase() === mail);
    if (hit) return hit.id;
  }
  const created = await api.request(identity, "/contacts", {
    method: "POST",
    body: { name, phone: phone || null, email: email || null, notes: notes || null },
  });
  return created.id;
}

const LEAD_KIND = { testdrive: "Prueba de manejo", trade: "Intercambio", contact: "Contacto", finance: "Financiamiento", visit: "Cita" };
const LEAD_DETAILS = [["topic", "Motivo"], ["down", "Inicial"], ["employment", "Empleo"], ["income", "Ingreso mensual"], ["credit", "Crédito"]];
// Runs after the visitor already has their answer, so it must never throw.
export async function pushLead(leadId) {
  try {
    await pushLeadNow(leadId);
  } catch (error) {
    console.error("Omnicanal lead sync failed:", error.message);
  }
}
async function pushLeadNow(leadId) {
  if (!client) return;
  const settings = await omniSettings();
  if (!settings.pushLeads) return;
  const { rows } = await query(
    "SELECT l.*,v.stock,v.data vehicle FROM leads l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.id=$1",
    [leadId],
  );
  const lead = rows[0];
  if (!lead) return;
  const parts = [`Consulta web: ${LEAD_KIND[lead.kind] || lead.kind}`];
  if (lead.vehicle) parts.push(`Vehículo: ${vehicleTitle(lead.vehicle)} (stock ${lead.stock})`);
  if (lead.data?.date) parts.push(`Fecha pedida: ${lead.data.date} ${lead.data.time || ""}`.trim());
  for (const [key, label] of LEAD_DETAILS) if (lead.data?.[key]) parts.push(`${label}: ${lead.data[key]}`);
  if (lead.data?.msg) parts.push(`Mensaje: ${lead.data.msg}`);
  const contactId = await upsertContact({
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    notes: parts.join("\n"),
  });
  await query("UPDATE leads SET omni_contact_id=$1 WHERE id=$2", [contactId, leadId]);
}

// ── Agenda ──────────────────────────────────────────────────────────────────────────────────
export const KIND_LABELS = {
  testdrive: "Prueba de manejo",
  visit: "Visita al concesionario",
  delivery: "Entrega de vehículo",
  call: "Llamada",
  followup: "Seguimiento",
  service: "Servicio / taller",
};
// The agenda is one table the site and Omnicanal both read and write (server/schema.sql), so an
// appointment is never sent anywhere: Omnicanal already has it. What Omnicanal still needs from
// the site is the customer as a contact in its CRM, which is what reminders and the chat are
// attached to. The appointment is already saved when this runs: a failure is recorded on it,
// never thrown, and the next edit tries again.
export async function linkAppointment(id) {
  if (!client) return;
  try {
    const { rows } = await query(
      "SELECT customer_name,customer_phone,customer_email,omni_contact_id FROM appointments WHERE id=$1",
      [id],
    );
    const a = rows[0];
    if (!a || a.omni_contact_id) return;
    const contactId = await upsertContact({ name: a.customer_name, phone: a.customer_phone, email: a.customer_email });
    await query("UPDATE appointments SET omni_contact_id=$1,sync_error=NULL WHERE id=$2", [contactId, id]);
  } catch (error) {
    await query("UPDATE appointments SET sync_error=$1 WHERE id=$2", [String(error.message).slice(0, 300), id]).catch(() =>
      console.error("Omnicanal contact link failed:", error.message),
    );
  }
}

// A sale that came from a chat closes that chat's sale in Omnicanal, credited to the agent.
export async function markConversationSale({ conversationId, sellerId, vehicle }) {
  if (!client || !conversationId) return;
  try {
    const { rows } = await query("SELECT id,name,role FROM admin_users WHERE id=$1", [sellerId]);
    const identity = rows[0] ? await identityFor(rows[0]).catch(() => systemIdentity()) : await systemIdentity();
    await client.request(identity, `/conversations/${conversationId}/sale`, {
      method: "POST",
      body: { closed: true, product: vehicleTitle(vehicle).slice(0, 200) },
    });
  } catch (error) {
    console.error("Omnicanal sale mark failed:", error.message);
  }
}

// ── Inventory → knowledge base of the virtual agents ───────────────────────────────────────
const KB_NAME = "Inventario del concesionario (sincronizado)";
let running = null,
  again = false,
  timer = null;
async function runSync(publicUrlFallback) {
  const api = ensure();
  const settings = await omniSettings();
  const { rows } = await query(
    "SELECT id,stock,status,data FROM vehicles WHERE status IN ('available','reserved')",
  );
  const content = inventoryKnowledge(rows, {
    dealer: await dealerInfo(),
    publicUrl: settings.publicUrl || publicUrlFallback || "",
    timeZone: DEALER_TZ,
  });
  const identity = await systemIdentity();
  const count = rows.filter((v) => !v.data.demo).length;
  try {
    let id = settings.knowledgeBaseId;
    if (id) {
      try {
        await api.request(identity, `/knowledge-bases/${id}`, { method: "PATCH", body: { content } });
      } catch (error) {
        if (error.status !== 404) throw error;
        id = null;
      }
    }
    if (!id) {
      const kb = await api.request(identity, "/knowledge-bases", {
        method: "POST",
        body: {
          name: KB_NAME,
          description:
            "La escribe el sitio del concesionario cada vez que cambia el inventario. No la edites aquí: se reemplaza.",
          content,
        },
      });
      id = kb.id;
    }
    const result = { knowledgeBaseId: id, lastSyncAt: new Date().toISOString(), lastSyncError: null, lastSyncCount: count };
    await saveOmniSettings(result);
    return result;
  } catch (error) {
    await saveOmniSettings({ lastSyncAt: new Date().toISOString(), lastSyncError: error.message });
    throw error;
  }
}
// One sync at a time; a change during a sync triggers exactly one more afterwards.
export async function syncInventory(publicUrlFallback) {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let result;
      do {
        again = false;
        result = await runSync(publicUrlFallback);
      } while (again);
      return result;
    } finally {
      running = null;
    }
  })();
  return running;
}
export function scheduleInventorySync(delay = 2500) {
  if (!client) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      if ((await omniSettings()).autoSync) await syncInventory();
    } catch (error) {
      console.error("Omnicanal inventory sync failed:", error.message);
    }
  }, delay);
  timer.unref?.();
}
export { OmniError };
