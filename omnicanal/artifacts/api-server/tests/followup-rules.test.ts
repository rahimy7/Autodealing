import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowGraph, WorkflowNode } from "@workspace/db";

const {
  customerFirstName,
  templateFor,
  renderTemplateTranscript,
  isMarketingOptOut,
  canSendFreeform,
  templateParam,
  isBareGreeting,
  isBareAcknowledgement,
  customerOnlyGreeted,
  winbackInstruction,
  quietHoursDelayMs,
  SELF_STARTED_KINDS,
  takeoverInstruction,
  postSaleOrderGate,
  addBusinessDays,
  COURTESY_CONTEXT,
  quickTurnSituation,
  courtesyInstruction,
  pendingNudge,
  deliveryBusinessDays,
} = await import("../src/lib/followup-rules.js");
const { triggersForEvent, triggerNumber } = await import("../src/lib/workflow-graph.js");

const node = (id: string, data: WorkflowNode["data"]): WorkflowNode => ({ id, position: { x: 0, y: 0 }, data });

describe("workflow-graph — triggersForEvent", () => {
  const graph: WorkflowGraph = {
    nodes: [
      node("T1", { kind: "trigger", event: "closed_no_sale", labelIds: [1, 2], delayHours: 3 }),
      node("A1", { kind: "agent", agentId: 10 }),
      node("T2", { kind: "trigger", event: "sale_closed" }),
      node("A2", { kind: "agent", agentId: 11 }),
      node("T3", { kind: "trigger", event: "unanswered" }),
      node("G", { kind: "group", groupId: 4 }),
    ],
    edges: [
      { id: "e1", source: "T1", target: "A1" },
      { id: "e2", source: "T2", target: "A2" },
      { id: "e3", source: "T3", target: "G" },
    ],
  };

  it("returns the trigger with the agent it is wired to", () => {
    const [found] = triggersForEvent(graph, "closed_no_sale");
    assert.equal(found.agentId, 10);
    assert.deepEqual(found.trigger.data.labelIds, [1, 2]);
    assert.equal(triggersForEvent(graph, "sale_closed")[0].agentId, 11);
  });

  it("ignores a trigger that is not wired to an agent — nobody would send it", () => {
    assert.deepEqual(triggersForEvent(graph, "unanswered"), []);
  });

  it("never mistakes a label node for a trigger", () => {
    const labelsOnly: WorkflowGraph = {
      nodes: [node("L", { kind: "label", labelId: 1 }), node("A", { kind: "agent", agentId: 1 })],
      edges: [{ id: "e", source: "L", target: "A" }],
    };
    assert.deepEqual(triggersForEvent(labelsOnly, "closed_no_sale"), []);
  });

  it("falls back to the default for empty or invalid numbers, but keeps an explicit zero", () => {
    assert.equal(triggerNumber(null, 4), 4);
    assert.equal(triggerNumber("", 4), 4);
    assert.equal(triggerNumber(-2, 4), 4);
    assert.equal(triggerNumber("7", 4), 7);
    assert.equal(triggerNumber(0, 4), 0);
  });
});

describe("followup-rules — customerFirstName", () => {
  it("uses the first name, capitalized", () => {
    assert.equal(customerFirstName("maría josé pérez"), "María");
    assert.equal(customerFirstName("JUAN"), "Juan");
  });

  it("falls back to 'de nuevo' when there is no usable name", () => {
    assert.equal(customerFirstName("Cliente 4321"), "de nuevo");
    assert.equal(customerFirstName("💜✨"), "de nuevo");
    assert.equal(customerFirstName(null), "de nuevo");
    assert.equal(customerFirstName("  "), "de nuevo");
  });
});

describe("followup-rules — templateFor", () => {
  const brand = "Procollagen Vital Essence";

  it("uses the product template when the product is known, the generic one otherwise", () => {
    assert.deepEqual(templateFor("winback", { customerName: "Ana Díaz", product: "Kit Duo", brand }), {
      name: "retomar_interes",
      variables: ["Ana", "Kit Duo"],
    });
    assert.deepEqual(templateFor("winback", { customerName: "Ana", product: null, brand }), {
      name: "reactivar_saludo",
      variables: ["Ana"],
    });
  });

  it("puts the brand in place of an unknown product in post-sale templates", () => {
    assert.deepEqual(templateFor("delivery_check", { customerName: null, product: null, brand }), {
      name: "confirmar_recepcion",
      variables: ["de nuevo", brand],
    });
    assert.equal(templateFor("repurchase", { customerName: "Luz", product: "Procollagen", brand }).name, "recordatorio_recompra");
    assert.equal(templateFor("unanswered", { customerName: "Luz", product: null, brand }).name, "retomar_conversacion");
  });

  it("strips what Meta rejects in a parameter", () => {
    assert.equal(templateParam("Kit\nDuo     Premium", "x"), "Kit Duo Premium");
    assert.equal(templateParam("   ", "fallback"), "fallback");
  });
});

describe("followup-rules — renderTemplateTranscript", () => {
  it("renders header, body with variables and the button options", () => {
    const text = renderTemplateTranscript(
      [
        { type: "HEADER", text: "¿Llegó tu pedido?" },
        { type: "BODY", text: "Hola {{1}} 👋\n\n¿Ya recibiste tu *{{2}}*?" },
        { type: "FOOTER", text: "Procollagen Vital Essence" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí, ya lo recibí" }, { type: "QUICK_REPLY", text: "Aún no llega" }] },
      ],
      ["Ana", "Kit Duo"],
    );
    assert.equal(text, "*¿Llegó tu pedido?*\n\nHola Ana 👋\n\n¿Ya recibiste tu *Kit Duo*?\n\n• Sí, ya lo recibí\n• Aún no llega");
  });
});

describe("followup-rules — isMarketingOptOut", () => {
  it("recognizes the template button and plain opt-out words", () => {
    assert.equal(isMarketingOptOut("No más promociones"), true);
    assert.equal(isMarketingOptOut("  no mas promociones! "), true);
    assert.equal(isMarketingOptOut("STOP"), true);
    assert.equal(isMarketingOptOut("Baja"), true);
  });

  it("does not treat a sentence that merely contains the word as an opt-out", () => {
    assert.equal(isMarketingOptOut("¿baja de precio?"), false);
    assert.equal(isMarketingOptOut("no quiero promociones, quiero el kit"), false);
    assert.equal(isMarketingOptOut(null), false);
  });
});

describe("followup-rules — canSendFreeform", () => {
  const now = new Date("2026-09-13T12:00:00Z");
  it("allows a free-form message well inside the 24h window only", () => {
    assert.equal(canSendFreeform(new Date("2026-09-13T01:00:00Z"), now), true);
    // 23h40m ago: inside the window but within the safety margin.
    assert.equal(canSendFreeform(new Date("2026-09-12T12:20:00Z"), now), false);
    assert.equal(canSendFreeform(new Date("2026-09-11T12:00:00Z"), now), false);
    assert.equal(canSendFreeform(null, now), false);
  });
});

describe("followup-rules — isBareGreeting", () => {
  it("recognizes a greeting with nothing else, however it is written", () => {
    for (const text of [
      "Hola",
      "hola!!",
      "Holaaaa 👋",
      "Buenas",
      "Buen día",
      "Buenos días, ¿cómo está?",
      "BUENAS TARDES",
      "Hola buenas noches, qué tal todo",
      "Saludos, bendiciones 🙏",
      "Hola señora, Dios le bendiga",
      "hi",
      "Good morning",
      "",
      "👋",
    ]) {
      assert.equal(isBareGreeting(text), true, text);
    }
  });

  it("does not treat a question that opens with a greeting as a greeting", () => {
    for (const text of [
      "Buen día. ¿Cuál es el precio del colágeno rosado?",
      "¿Cómo puedo comprar tus productos?",
      "Hola, precio",
      "Buenas, ¿hacen envíos a Santiago?",
      "hola info",
      "¿Cómo se toma?",
      "Hola, quiero comprar 2",
      "Está disponible?",
    ]) {
      assert.equal(isBareGreeting(text), false, text);
    }
  });
});

describe("followup-rules — customerOnlyGreeted", () => {
  const msg = (sender: string, content: string, type = "text") => ({ sender, type, content });

  it("is true when everything the customer wrote was a greeting", () => {
    assert.equal(customerOnlyGreeted([msg("contact", "Hola"), msg("bot", "¡Hola! 💗 Mira el catálogo…")]), true);
    assert.equal(customerOnlyGreeted([msg("contact", "Buenas"), msg("contact", "hola?")]), true);
  });

  it("is false when the customer asked something, sent a file or wrote nothing", () => {
    assert.equal(customerOnlyGreeted([msg("contact", "Hola"), msg("contact", "¿precio?")]), false);
    assert.equal(customerOnlyGreeted([msg("contact", "📷 Imagen", "image")]), false);
    assert.equal(customerOnlyGreeted([msg("bot", "Hola")]), false);
  });
});

describe("followup-rules — winbackInstruction", () => {
  it("opens the sale for a customer who only greeted and got the welcome", () => {
    const text = winbackInstruction("El cliente solo saludó y no dijo qué buscaba.", { onlyGreeted: true, answered: true });
    assert.match(text, /Ábrele la venta/);
    assert.match(text, /no te disculpes/);
    assert.match(text, /con su precio/);
    assert.doesNotMatch(text, /discúlpate/);
  });

  it("apologizes first when nobody answered the greeting", () => {
    const text = winbackInstruction(null, { onlyGreeted: true, answered: false });
    assert.match(text, /discúlpate en pocas palabras por la demora/);
    assert.match(text, /con su precio/);
  });

  it("answers a pending question with the exact price before anything else", () => {
    const text = winbackInstruction("Preguntó el precio.", { onlyGreeted: false, answered: true });
    assert.match(text, /empieza contestándolo con tu base de conocimiento: el precio exacto/);
    assert.match(text, /Contexto: Preguntó el precio\./);
    assert.doesNotMatch(text, /sin inventar descuentos, precios/);
  });

  it("no vuelve a preguntar cuando el último mensaje del chat es nuestro", () => {
    const text = winbackInstruction("Se le dio el precio y no volvió a escribir.", {
      onlyGreeted: false,
      answered: true,
      lastFromUs: true,
    });
    assert.match(text, /no le preguntes nada/);
    assert.match(text, /quédate a la orden/);
    // La pregunta de cierre es justo lo que sobra cuando ya se le contestó todo.
    assert.doesNotMatch(text, /termina con una pregunta fácil de contestar/);
  });

  it("todas las variantes le piden leer la conversación y no repetir lo ya dicho", () => {
    for (const session of [
      { onlyGreeted: true, answered: true },
      { onlyGreeted: true, answered: false },
      { onlyGreeted: false, answered: true },
      { onlyGreeted: false, answered: true, lastFromUs: true },
    ]) {
      const text = winbackInstruction(null, session);
      assert.match(text, /no preguntes nada que el cliente ya haya dicho ahí/, JSON.stringify(session));
    }
  });
});

describe("followup-rules — ventana de silencio", () => {
  it("de 12 de la noche a 8 de la mañana espera hasta las 8:00", () => {
    assert.equal(quietHoursDelayMs({ hour: 0, minute: 0 }), 8 * 60 * 60 * 1000);
    assert.equal(quietHoursDelayMs({ hour: 0, minute: 30 }), 7.5 * 60 * 60 * 1000);
    assert.equal(quietHoursDelayMs({ hour: 7, minute: 59 }), 60 * 1000);
  });

  it("fuera de la madrugada sale enseguida", () => {
    for (const hour of [8, 9, 13, 20, 23]) {
      assert.equal(quietHoursDelayMs({ hour, minute: 0 }), 0, `${hour}:00`);
      assert.equal(quietHoursDelayMs({ hour, minute: 59 }), 0, `${hour}:59`);
    }
  });

  it("solo frena lo que arranca solo: al cliente que escribió se le contesta", () => {
    assert.ok(SELF_STARTED_KINDS.includes("winback"));
    assert.ok(SELF_STARTED_KINDS.includes("repurchase"));
    assert.ok(!SELF_STARTED_KINDS.includes("unanswered"));
  });
});

// Una clienta contestó al formato del pedido "después de las 10:00 am puedo
// recibir" y el agente que retomó el chat le preguntó "¿en qué puedo ayudarte
// hoy?". Retomar no es empezar.
describe("followup-rules — takeoverInstruction", () => {
  it("le pide leer dónde quedó, incluido lo que mandó el equipo", () => {
    const text = takeoverInstruction();
    assert.match(text, /lee dónde quedó/);
    assert.match(text, /lo que le mandó una persona del equipo/);
  });

  it("a lo que solo informa o agradece le toca un cierre cortés, sin preguntar en qué ayudar", () => {
    const text = takeoverInstruction();
    assert.match(text, /no hace falta seguimiento/);
    assert.match(text, /Nos mantenemos en contacto/);
    assert.match(text, /no le preguntes en qué puedes ayudarle/);
    assert.match(text, /No lo saludes como si fuera una conversación nueva/);
  });

  it("lo que no sabe no lo contesta: escala", () => {
    assert.match(takeoverInstruction(), /ESCALAR_A_HUMANO/);
  });

  it("la marca de cortesía se puede reconocer en el contexto del seguimiento", () => {
    assert.ok(`El cliente escribió «gracias». ${COURTESY_CONTEXT}`.includes(COURTESY_CONTEXT));
  });
});

// El "¿te llegó tu pedido?" salía a clientes sin pedido.
describe("followup-rules — postSaleOrderGate", () => {
  it("sin pedido registrado no sale ningún post-venta", () => {
    for (const kind of ["delivery_check", "satisfaction", "repurchase"] as const) {
      assert.equal(postSaleOrderGate(kind, null).action, "cancel", kind);
    }
  });

  it("con el pedido cancelado tampoco", () => {
    assert.deepEqual(postSaleOrderGate("delivery_check", "cancelled"), {
      action: "cancel",
      detail: "su pedido está cancelado",
    });
  });

  it("la confirmación de entrega espera a que el pedido cambie a Enviado o Entregado", () => {
    assert.equal(postSaleOrderGate("delivery_check", "pending").action, "wait");
    assert.equal(postSaleOrderGate("delivery_check", "processing").action, "wait");
    assert.equal(postSaleOrderGate("delivery_check", "shipped").action, "send");
    assert.equal(postSaleOrderGate("delivery_check", "delivered").action, "send");
    assert.equal(postSaleOrderGate("satisfaction", "processing").action, "wait");
  });

  it("el recordatorio de recompra sale con cualquier pedido vivo", () => {
    assert.equal(postSaleOrderGate("repurchase", "pending").action, "send");
    assert.equal(postSaleOrderGate("repurchase", "delivered").action, "send");
  });
});

describe("followup-rules — addBusinessDays", () => {
  const utc = (iso: string) => new Date(iso);

  it("salta el fin de semana", () => {
    // Jueves 17/09/2026 + 3 hábiles = martes 22/09.
    assert.equal(addBusinessDays(utc("2026-09-17T15:00:00Z"), 3).toISOString(), "2026-09-22T15:00:00.000Z");
    // Viernes + 1 hábil = lunes.
    assert.equal(addBusinessDays(utc("2026-09-18T15:00:00Z"), 1).toISOString(), "2026-09-21T15:00:00.000Z");
  });

  it("entre semana suma días seguidos", () => {
    assert.equal(addBusinessDays(utc("2026-09-14T15:00:00Z"), 2).toISOString(), "2026-09-16T15:00:00.000Z");
  });

  it("usa el día de la semana que se le indique (la hora del negocio)", () => {
    // Todo es fin de semana salvo los lunes: tres lunes seguidos.
    const onlyMondays = (d: Date) => (d.getUTCDay() === 1 ? 1 : 0);
    assert.equal(
      addBusinessDays(utc("2026-09-15T12:00:00Z"), 3, onlyMondays).toISOString(),
      "2026-10-05T12:00:00.000Z",
    );
  });
});

// «Ay lástima. Gracias muy amable» al «no enviamos a España» del día anterior: el
// bot contestó «Hola, ¿en qué puedo ayudarte hoy?».
describe("followup-rules — situación del chat", () => {
  const text = (t: string, weAskedLast = false) => quickTurnSituation({ text: t, type: "text", weAskedLast });

  it("lo evidente se contesta sin consultar a la IA", () => {
    assert.equal(text("¿Cuánto cuesta?"), "answer");
    assert.equal(text("Hola"), "answer");
    assert.equal(text("Buenas tardes"), "answer");
    assert.equal(quickTurnSituation({ text: "📷 Imagen", type: "image", weAskedLast: false }), "answer");
  });

  it("a una pregunta nuestra, su «sí» es respuesta y se sigue", () => {
    assert.equal(text("Sí", true), "answer");
    assert.equal(text("San Pedro", true), "answer");
  });

  it("lo que puede ser un cierre lo decide la IA con el contexto", () => {
    assert.equal(text("Ay lástima. Gracias muy amable"), null);
    assert.equal(text("Gracias"), null);
    assert.equal(text("Quedo atenta a la orden después de las 10:00am puedo recibir"), null);
    // Un emoji suelto no es un saludo: puede ser un cierre que no hay que contestar.
    assert.equal(text("👍"), null);
    assert.equal(text("🙏🙏"), null);
  });

  it("el cierre cortés no pregunta, no ofrece y no saluda como nuevo", () => {
    const instruction = courtesyInstruction();
    assert.match(instruction, /UNA sola línea con un cierre cortés/);
    assert.match(instruction, /no le preguntes en qué puedes ayudarle, no le hagas ninguna pregunta y no le ofrezcas productos/);
    assert.match(instruction, /No lo saludes como si fuera una conversación nueva/);
    assert.match(instruction, /un envío a un país al que no llegamos/);
  });
});

describe("followup-rules — un solo mensaje por iniciativa propia", () => {
  const at = (iso: string) => new Date(iso);
  const lastCustomer = at("2026-09-10T15:00:00Z");

  it("si ya se le escribió después de su último mensaje, no se le escribe otra vez", () => {
    const sent = [{ kind: "delivery_check", sentAt: at("2026-09-14T15:00:00Z") }];
    assert.deepEqual(pendingNudge(lastCustomer, sent), sent[0]);
  });

  it("lo que se le mandó antes de que contestara no cuenta", () => {
    assert.equal(pendingNudge(lastCustomer, [{ kind: "winback", sentAt: at("2026-09-09T15:00:00Z") }]), null);
    assert.equal(pendingNudge(lastCustomer, [{ kind: "winback", sentAt: null }]), null);
    assert.equal(pendingNudge(lastCustomer, []), null);
  });
});

describe("followup-rules — días de entrega por país", () => {
  it("República Dominicana 3 días hábiles; Estados Unidos (pedido con correo) 5", () => {
    assert.equal(deliveryBusinessDays({ email: null }), 3);
    assert.equal(deliveryBusinessDays({ email: "  " }), 3);
    assert.equal(deliveryBusinessDays({ email: "cliente@correo.com" }), 5);
  });
});

describe("followup-rules — isBareAcknowledgement", () => {
  // Regla del 2026-09-20: un "sí" o un "ok" a secas no deja la conversación
  // pendiente de respuesta. Es lo que contesta quien ya sabe que lo van a
  // atender, y tomarlo por pregunta hacía que el bot le retomara el chat.
  it("reconoce los cierres cortos, con o sin énfasis", () => {
    for (const text of [
      "si", "Sí", "ok", "OK", "Okey", "okkk", "siii", "vale", "listo", "dale",
      "de acuerdo", "De acuerdo.", "deacuerdo", "perfecto", "Claro", "entendido",
      "Está bien", "esta bien", "muy bien", "gracias", "Muchas gracias", "ok gracias",
      "correcto", "anotado", "bueno",
    ]) {
      assert.equal(isBareAcknowledgement(text), true, text);
    }
  });

  it("no se traga nada que pida algo", () => {
    for (const text of [
      "ok?", "¿ok?", "si, pero cuándo llega", "ok y mi rastreo", "de acuerdo, mándame el número",
      "no", "no he recibido nada", "listo el pago, te mando el comprobante",
      "gracias, pero necesito el rastreo", "bien y el pedido", "quiero uno",
    ]) {
      assert.equal(isBareAcknowledgement(text), false, text);
    }
  });

  it("un texto vacío no es un cierre", () => {
    assert.equal(isBareAcknowledgement(""), false);
    assert.equal(isBareAcknowledgement("   "), false);
  });

  it("un emoji suelto no entra aquí: lo decide la situación del chat", () => {
    assert.equal(isBareAcknowledgement("👍"), false);
  });
});
