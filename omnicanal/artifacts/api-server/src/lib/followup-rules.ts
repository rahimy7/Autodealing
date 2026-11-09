import type { FollowupKind } from "@workspace/db";

// Reglas puras del motor de seguimientos (lib/followups.ts): qué plantilla lleva
// cada gestión, con qué variables, y cómo se lee lo que contesta el cliente. Sin
// base de datos ni red, para poder probarlas solas.

export const FOLLOWUP_KIND_LABELS: Record<FollowupKind, string> = {
  winback: "recuperación de venta",
  delivery_check: "confirmación de entrega",
  satisfaction: "encuesta de satisfacción",
  repurchase: "recordatorio de recompra",
  unanswered: "respuesta a una consulta que había quedado sin contestar",
};

// Las que son promoción: no le llegan a quien pidió "No más promociones". Las del
// pedido (entrega, satisfacción) y la respuesta pendiente sí, porque las pidió él.
export const MARKETING_KINDS: FollowupKind[] = ["winback", "repurchase"];
export const POST_SALE_KINDS: FollowupKind[] = ["delivery_check", "satisfaction", "repurchase"];

// Valores por defecto de los nodos disparador cuando el campo está vacío.
export const TRIGGER_DEFAULTS = {
  winbackDelayHours: 3,
  unansweredDelayHours: 2,
  deliveryDays: 4,
  satisfactionDays: 12,
  repurchaseDays: 25,
} as const;

// Cuánto tiempo después de enviado un seguimiento se sigue considerando que el
// cliente le está contestando a él (y no escribiendo por otra cosa).
export const FOLLOWUP_REPLY_WINDOW_MS = 72 * 60 * 60 * 1000;

// Un cliente recibe como mucho un intento de recuperación cada tantos días,
// aunque cierre varios chats sin comprar: más que eso es acoso y le cuesta la
// calidad al número.
export const WINBACK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

// Ventana de silencio: de 12 de la noche a 8 de la mañana (hora del negocio) no
// sale ningún seguimiento por iniciativa nuestra —ni la recuperación, ni el
// post-venta—, se reprograma para las 8:00. Lo que el cliente escriba de
// madrugada se le contesta igual: esto solo frena los mensajes que arrancan
// solos. `unanswered` tampoco entra: ahí el cliente escribió y está esperando.
export const QUIET_FROM_HOUR = 0;
export const QUIET_TO_HOUR = 8;
export const SELF_STARTED_KINDS: FollowupKind[] = ["winback", "delivery_check", "satisfaction", "repurchase"];

/**
 * Cuánto falta para las 8:00 si esa hora del negocio cae en la ventana de
 * silencio; 0 si el seguimiento puede salir ya.
 */
export function quietHoursDelayMs(clock: { hour: number; minute: number }): number {
  if (clock.hour < QUIET_FROM_HOUR || clock.hour >= QUIET_TO_HOUR) return 0;
  return ((QUIET_TO_HOUR - clock.hour) * 60 - clock.minute) * 60 * 1000;
}

// Margen antes del cierre de la ventana de 24h: redactar y enviar tarda, y un
// mensaje libre que llega un minuto tarde Meta lo rechaza.
const WINDOW_MARGIN_MS = 30 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function canSendFreeform(lastCustomerMessageAt: Date | null, now: Date = new Date()): boolean {
  if (!lastCustomerMessageAt) return false;
  return now.getTime() < lastCustomerMessageAt.getTime() + WINDOW_MS - WINDOW_MARGIN_MS;
}

// Nombres de las plantillas que crea scripts/create-templates-<cliente>.ts. Son
// contrato: el texto cambia por cliente, el nombre no.
export const FOLLOWUP_TEMPLATE_NAMES = {
  unanswered: "retomar_conversacion",
  winbackGeneric: "reactivar_saludo",
  winbackProduct: "retomar_interes",
  delivery_check: "confirmar_recepcion",
  satisfaction: "encuesta_satisfaccion",
  repurchase: "recordatorio_recompra",
} as const;

// Todas las plantillas automáticas abren con "Hola {{1}}". Sin un nombre usable
// queda "Hola de nuevo", que se lee natural en todas.
const NAME_FALLBACK = "de nuevo";
const PLACEHOLDER_NAME = /^Cliente\s/i;

export function customerFirstName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw || PLACEHOLDER_NAME.test(raw)) return NAME_FALLBACK;
  const first = raw.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "");
  if (first.length < 2) return NAME_FALLBACK;
  const clipped = first.slice(0, 30);
  return clipped.charAt(0).toLocaleUpperCase("es") + clipped.slice(1).toLocaleLowerCase("es");
}

// Meta rechaza un parámetro con saltos de línea, tabuladores o más de cuatro
// espacios seguidos, y uno vacío.
export function templateParam(value: string, fallback: string): string {
  const clean = value.replace(/[\n\t\r]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 200);
  return clean || fallback;
}

export type TemplateChoice = { name: string; variables: string[] };

// La plantilla de cada gestión. `brand` sustituye al producto cuando no se sabe
// cuál fue: "tu pedido de *Procollagen Vital Essence*" se lee bien.
//
// Desde el 2026-09-20 el motor de seguimientos ya no la llama: las plantillas las
// envía una persona desde el panel, nunca un agente virtual. Queda como el mapa
// de qué plantilla corresponde a cada gestión, para quien la mande a mano.
export function templateFor(
  kind: FollowupKind,
  opts: { customerName: string | null | undefined; product: string | null; brand: string },
): TemplateChoice {
  const first = customerFirstName(opts.customerName);
  const product = opts.product ? templateParam(opts.product, opts.brand) : null;
  switch (kind) {
    case "unanswered":
      return { name: FOLLOWUP_TEMPLATE_NAMES.unanswered, variables: [first] };
    case "winback":
      return product
        ? { name: FOLLOWUP_TEMPLATE_NAMES.winbackProduct, variables: [first, product] }
        : { name: FOLLOWUP_TEMPLATE_NAMES.winbackGeneric, variables: [first] };
    case "delivery_check":
    case "satisfaction":
    case "repurchase":
      return { name: FOLLOWUP_TEMPLATE_NAMES[kind], variables: [first, product ?? opts.brand] };
  }
}

// Lo que se le pide al agente que retoma un chat cerrado sin venta, dentro de la
// ventana de 24h. Según cómo quedó la sesión:
// - solo saludó y se le contestó (la bienvenida o el agente) y no volvió: se le
//   abre la venta, sin disculpas ni otra bienvenida;
// - solo saludó y nadie le contestó: disculpa breve y, con ella, la venta;
// - preguntó algo y quedó sin contestar: primero se le contesta lo pendiente.
//   Preguntó el precio, le salió la bienvenida en su lugar, y la recuperación le
//   ofreció "reservarle uno y enviarle el monto" sin decirle cuánto cuesta: "sin
//   inventar precios" se leía como "no des precios";
// - preguntó algo, se le contestó y el último mensaje del chat es nuestro: no hay
//   nada que preguntarle. Pedido el 2026-09-17: el seguimiento tiene que leer la
//   conversación y ser coherente con ella, no repetir una pregunta cuya respuesta
//   ya está en el chat ni sacar un tema que no venga a cuento. Ahí se saluda y se
//   queda a la orden.
export function winbackInstruction(
  context: string | null,
  session: { onlyGreeted: boolean; answered: boolean; lastFromUs?: boolean },
): string {
  const offer =
    "ofrécele directamente el producto por el que más escriben los clientes según tu base de conocimiento, con su precio (y el envío gratis si aplica), y termina con una pregunta como '¿Te gustaría llevarte el tuyo?'";
  const pending =
    "Si preguntó algo que no se le contestó (el precio, el envío, cómo pagar…), empieza contestándolo con tu base de conocimiento: el precio exacto, no 'te envío el monto'. ";
  const task = !session.onlyGreeted
    ? session.lastFromUs
      ? pending +
        "Si ya se le contestó todo y el último mensaje del chat es nuestro, no le preguntes nada: ni lo que ya te dijo, " +
        "ni lo que ya se le respondió, ni un tema nuevo que no venga a cuento. Salúdalo en una línea y quédate a la orden " +
        "para cuando quiera seguir ('cualquier cosa, aquí estoy'), sin presionar y sin pedirle una respuesta."
      : pending +
        "Si ya se le contestó, retoma lo que buscaba sin repetir lo que ya se le dijo. " +
        "Ofrécele ayuda concreta para dar el siguiente paso y termina con una pregunta fácil de contestar."
    : session.answered
      ? "Solo saludó, ya se le contestó el saludo y no volvió a escribir: no te disculpes ni repitas la bienvenida ni el enlace que ya recibió. " +
        `Ábrele la venta: pregúntale en qué le puedes ayudar y ${offer}.`
      : `Solo saludó y nadie le atendió: discúlpate en pocas palabras por la demora, pregúntale en qué le puedes ayudar y ${offer}.`;
  return (
    "INSTRUCCIÓN DEL SISTEMA (no la escribió el cliente): la conversación de arriba se cerró sin venta. " +
    "Escríbele ahora TÚ al cliente UN solo mensaje breve (2 o 3 oraciones) para retomarla. " +
    "Léela entera antes de escribir y sé coherente con ella: no preguntes nada que el cliente ya haya dicho ahí " +
    "(qué producto quiere, dónde vive, cómo va a pagar) ni nada que ya se le haya contestado. " +
    (context ? `Contexto: ${context} ` : "") +
    `${task} ` +
    "Sin presión y sin decir que es un mensaje automático. Precios, solo los de tu base de conocimiento; no inventes descuentos, existencias ni urgencias. No escales."
  );
}

// Lo que se le pide al agente que retoma un chat que el equipo dejó sin contestar
// (pasó la ventana de gracia del humano, o el seguimiento "sin respuesta" se lo
// pasó). Retomar no es empezar: el 2026-09-18 el agente que retomó el chat de
// una clienta —a quien el equipo le había mandado el formato del pedido y que
// contestó a qué hora podía recibir— le escribió "Hola <nombre>, ¿en qué
// puedo ayudarte hoy?". Lo que tocaba era acusar el dato y quedar en contacto. No
// siempre hace falta seguimiento: a veces basta un "siempre a la orden".
export function takeoverInstruction(): string {
  return (
    "INSTRUCCIÓN DEL SISTEMA (no la escribió el cliente): retomas una conversación que el equipo dejó sin contestar. " +
    "Antes de escribir, lee dónde quedó, incluido lo que le mandó una persona del equipo (un pedido, una guía de envío, un formato) y el mensaje que el cliente citó. " +
    "Si lo último del cliente pregunta o pide algo, contéstalo con tu base de conocimiento; si no tienes el dato, responde solo 'ESCALAR_A_HUMANO'. " +
    "Si solo informa, confirma o agradece —a qué hora puede recibir, que queda atento, 'gracias' por algo que se le envió—, no hace falta seguimiento: " +
    "contéstale en una línea con un cierre cortés que acuse lo que dijo ('De acuerdo, anotado. Nos mantenemos en contacto 🙌', '¡Siempre a la orden!'). " +
    "No lo saludes como si fuera una conversación nueva, no le preguntes en qué puedes ayudarle, no te disculpes por la demora si no preguntó nada y no le ofrezcas productos."
  );
}

// Marca que va en el contexto de un "sin respuesta" cuando lo que toca es solo un
// cierre cortés (el cliente informó, confirmó o agradeció). La lee el agente, y
// lib/followups.ts la usa para no mandar una plantilla por algo que no la merece.
export const COURTESY_CONTEXT = "No pedía nada: solo informaba, confirmaba o agradecía; basta un cierre cortés.";

// ── Post-venta contra la tabla de pedidos ─────────────────────────────────────
// El "¿te llegó tu pedido?" salía a clientes que no tenían pedido: bastaba con que
// la IA leyera una venta en el chat al cerrarse (o que alguien marcara "Venta
// cerrada"). Pedido el 2026-09-18: se valida contra Pedidos y el pedido tiene que
// haber cambiado de estado antes. Qué hacer con cada seguimiento según el pedido
// más reciente del cliente:
//   - sin pedido, o cancelado: no sale;
//   - confirmar la entrega o preguntar cómo le fue: solo con el pedido ya Enviado
//     o Entregado; mientras siga Pendiente o En proceso, se espera;
//   - recordar la recompra: con cualquier pedido que no esté cancelado.
export type OrderGate = { action: "send" } | { action: "wait"; detail: string } | { action: "cancel"; detail: string };

export function postSaleOrderGate(
  kind: FollowupKind,
  orderStatus: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | null,
): OrderGate {
  if (orderStatus === null) return { action: "cancel", detail: "el cliente no tiene un pedido registrado en Pedidos" };
  if (orderStatus === "cancelled") return { action: "cancel", detail: "su pedido está cancelado" };
  if (kind === "delivery_check" || kind === "satisfaction") {
    if (orderStatus === "pending" || orderStatus === "processing") {
      return { action: "wait", detail: "su pedido todavía no se ha enviado" };
    }
  }
  return { action: "send" };
}

// Lo que tarda la entrega (dato del negocio): de 2 a 3 días hábiles en República
// Dominicana (2026-09-18) y de 1 a 5 en Estados Unidos por UPS (2026-09-19). Al
// marcarse un pedido como Enviado, la confirmación de entrega se corre a después
// del último de esos días, para no preguntar "¿te llegó?" antes de tiempo. El
// pedido de Estados Unidos es el que trae correo (solo ahí se pide, para el
// rastreo).
export const DELIVERY_BUSINESS_DAYS = 3;
export const US_DELIVERY_BUSINESS_DAYS = 5;

export function deliveryBusinessDays(order: { email: string | null }): number {
  return order.email?.trim() ? US_DELIVERY_BUSINESS_DAYS : DELIVERY_BUSINESS_DAYS;
}

/**
 * `from` más `days` días hábiles (sin sábados ni domingos), a la misma hora.
 * `weekdayOf` dice qué día de la semana es un instante en la hora del negocio
 * (0 = domingo); por defecto, en UTC.
 */
export function addBusinessDays(
  from: Date,
  days: number,
  weekdayOf: (date: Date) => number = (date) => date.getUTCDay(),
): Date {
  let result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result = new Date(result.getTime() + 24 * 60 * 60 * 1000);
    const weekday = weekdayOf(result);
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return result;
}

type TemplateComponent = {
  type?: string | null;
  text?: string | null;
  buttons?: Array<Record<string, unknown>> | null;
};

// Lo que se guarda en el historial de la conversación: el texto tal como lo leyó
// el cliente, con las opciones de los botones. El agente que atienda la respuesta
// tiene que saber qué se le dijo, no solo que "se mandó una plantilla".
export function renderTemplateTranscript(components: TemplateComponent[], variables: string[]): string {
  const fill = (text: string) => text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => variables[Number(n) - 1] ?? "");
  const byType = (type: string) => components.find((c) => (c.type ?? "").toUpperCase() === type);
  const parts: string[] = [];
  const header = byType("HEADER")?.text;
  if (header) parts.push(`*${fill(header)}*`);
  const body = byType("BODY")?.text;
  if (body) parts.push(fill(body));
  const buttons = (byType("BUTTONS")?.buttons ?? [])
    .map((b) => (typeof b.text === "string" ? b.text : null))
    .filter((t): t is string => !!t);
  if (buttons.length) parts.push(buttons.map((t) => `• ${t}`).join("\n"));
  return parts.join("\n\n");
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "No más promociones" es el botón de las plantillas de marketing. Solo cuenta el
// mensaje entero: un "baja" dentro de una frase ("¿baja de precio?") no es una baja.
const OPT_OUT_PHRASES = new Set(["no mas promociones", "stop", "baja", "no quiero mas promociones"]);

export function isMarketingOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  return OPT_OUT_PHRASES.has(normalize(text));
}

// Palabras de un saludo sin más ("Hola", "Buenas tardes", "Buen día, ¿cómo está?",
// "Holaaa 🙏 bendiciones"), ya sin tildes y con las letras repetidas juntadas.
const GREETING_WORDS = new Set(
  [
    "hola", "ola", "holi", "holis", "alo", "hey", "hi", "hello",
    "buenas", "buenos", "buena", "buen", "dia", "dias", "tarde", "tardes", "noche", "noches",
    "good", "morning", "afternoon", "evening",
    "saludos", "saludo", "cordial", "que", "tal", "como", "esta", "estas", "estan", "todo", "bien", "muy",
    "bendiciones", "bendecido", "bendecida", "dios", "le", "la", "les", "te", "lo", "bendiga",
    "senora", "senor", "senorita", "amiga", "amigo", "mi", "y", "usted", "ustedes",
    "disculpe", "disculpa", "por", "favor", "porfa",
  ].map(squeezeLetters),
);

function squeezeLetters(word: string): string {
  return word.replace(/(\p{L})\1+/gu, "$1");
}

// Un mensaje que solo saluda. La bienvenida contesta a un saludo; a una pregunta
// ("Buen día. ¿Cuál es el precio del colágeno?") no: si sale en su lugar, la
// pregunta se queda sin respuesta.
export function isBareGreeting(text: string): boolean {
  const words = normalize(text).split(" ").filter(Boolean);
  return words.every((w) => GREETING_WORDS.has(squeezeLetters(w)));
}

// ── Un "ok" no es una pregunta ────────────────────────────────────────────────
// Regla del 2026-09-20: un "sí", un "ok" o un "de acuerdo" a secas NO deja la
// conversación pendiente de respuesta. Es lo que el cliente contesta cuando ya se
// le dijo que una persona lo iba a atender: tomarlo por una pregunta hacía que el
// agente virtual le retomara el chat y le repitiera el aviso.
//
// Ojo con el único caso en que un "sí" sí importa: cuando responde a una pregunta
// NUESTRA ("¿te lo envío?"). Por eso quien llama comprueba antes `weAskedLast` —
// ahí la venta sigue y esto no se aplica.
const ACKNOWLEDGEMENT_PHRASES = new Set([
  "si", "sisi", "ok", "oka", "okay", "okey", "oki", "okis", "vale", "dale", "listo", "correcto",
  "claro", "perfecto", "excelente", "bien", "esta bien", "muy bien", "de acuerdo", "deacuerdo",
  "entendido", "anotado", "va", "yaesta", "ya esta", "aja", "ah ok", "ok gracias", "si gracias",
  "gracias", "muchas gracias", "mil gracias", "gracias a ti", "ok perfecto", "si claro",
  "esta bien gracias", "de acuerdo gracias", "listo gracias", "bueno", "bueno gracias",
]);

export function isBareAcknowledgement(text: string): boolean {
  const cleaned = normalize(text);
  if (!cleaned) return false;
  // Con signo de interrogación no es un cierre, por corto que sea ("¿ok?").
  if (/[?¿]/.test(text)) return false;
  // "siii", "okkk" y "listooo" son el mismo cierre escrito con énfasis.
  return (
    ACKNOWLEDGEMENT_PHRASES.has(cleaned) ||
    ACKNOWLEDGEMENT_PHRASES.has(cleaned.split(" ").map(squeezeLetters).join(" "))
  );
}

// El cliente escribió en la sesión y todo lo que escribió fue saludar: no dijo qué
// buscaba. Un adjunto o un botón ya dicen algo.
export function customerOnlyGreeted(messages: Array<{ sender: string; type: string; content: string }>): boolean {
  const fromCustomer = messages.filter((m) => m.sender === "contact");
  return (
    fromCustomer.length > 0 &&
    fromCustomer.every((m) => (m.type === "text" || m.type === "audio") && isBareGreeting(m.content))
  );
}

// ── Situación del chat ────────────────────────────────────────────────────────
// Antes de redactar, el backend decide en qué situación está el chat y le da al
// agente UNA instrucción, en vez de dejarle al modelo conciliar reglas que tiran
// para lados distintos ("conversación nueva: salúdalo y pregúntale en qué ayudar"
// contra "a quien agradece, un cierre cortés"). Pedido el 2026-09-19 sobre un
// «Ay lástima. Gracias muy amable» al «no enviamos a España» del día anterior,
// que el bot contestó con «Hola, ¿en qué puedo ayudarte hoy?».
//   - answer:   pregunta, pide, retoma algo o contesta a una pregunta nuestra.
//   - courtesy: agradece, confirma, lamenta o informa: una línea de cierre cortés.
//   - none:     solo cierra (ok, emoji, otro gracias) y ya se le había despedido:
//               contestarle otra vez sería escribir de más.
// Lo evidente se decide aquí, sin IA; lo demás lo decide `classifyTurnSituation`.
const QUICK_ANSWER_MIN_WORDS = 16;

export function quickTurnSituation(opts: {
  text: string;
  type: string;
  // Nuestro último mensaje antes del del cliente terminaba en pregunta: su
  // "sí", "el de 100" o "San Pedro" es la respuesta y hay que seguir.
  weAskedLast: boolean;
}): "answer" | null {
  if (opts.type !== "text" && opts.type !== "audio") return "answer"; // un comprobante, una foto
  const text = opts.text.trim();
  if (!text) return "answer";
  if (/[?¿]/.test(text)) return "answer";
  if (opts.weAskedLast) return "answer";
  // Solo emojis ("👍", "🙏"): isBareGreeting lo daría por saludo (no hay palabras
  // que no lo sean). Lo decide la IA con el contexto.
  if (!/\p{L}/u.test(text)) return null;
  if (isBareGreeting(text)) return "answer";
  if (text.split(/\s+/).length >= QUICK_ANSWER_MIN_WORDS) return "answer";
  return null;
}

// La instrucción cuando el cliente no pide nada. Va al final del prompt, como la
// de retomar, y manda sobre la de "conversación nueva".
export function courtesyInstruction(): string {
  return (
    "INSTRUCCIÓN DEL SISTEMA (no la escribió el cliente): el último mensaje del cliente no pide nada: agradece, confirma, lamenta o te da un dato sobre algo ya hablado. " +
    "Contéstale en UNA sola línea con un cierre cortés que acuse lo que dijo ('¡Con gusto! 🙌', 'De acuerdo, anotado. Nos mantenemos en contacto.', '¡Siempre a la orden!'). " +
    "Si lamenta algo que no se puede (por ejemplo, un envío a un país al que no llegamos), acúsalo con amabilidad y quédate a la orden, sin ofrecerle nada. " +
    "No lo saludes como si fuera una conversación nueva, no le preguntes en qué puedes ayudarle, no le hagas ninguna pregunta y no le ofrezcas productos."
  );
}

// ── Un solo mensaje por iniciativa propia ─────────────────────────────────────
// Regla del 2026-09-19: el bot no escribe varias veces sin que el cliente
// responda. Después del último mensaje del cliente sale como mucho UN mensaje
// por iniciativa nuestra (una recuperación, una confirmación de entrega…); el
// siguiente espera a que el cliente conteste. Devuelve el seguimiento que ya se
// le mandó y sigue sin respuesta, o null si se le puede escribir.
export function pendingNudge<T extends { sentAt: Date | null }>(
  lastCustomerMessageAt: Date | null,
  sent: T[],
): T | null {
  const since = lastCustomerMessageAt?.getTime() ?? 0;
  return sent.find((f) => f.sentAt != null && f.sentAt.getTime() > since) ?? null;
}
