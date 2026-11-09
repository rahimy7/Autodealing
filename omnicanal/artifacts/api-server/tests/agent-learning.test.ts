import { describe, it } from "node:test";
import assert from "node:assert/strict";

// agent-learning pulls in @workspace/db, which refuses to load without a
// connection string. Nothing here touches the pool — only the pure logic.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";

const { pickReviewPair, shouldAutoActivate, LESSON_AUTO_ACTIVATE_CONVERSATIONS } = await import(
  "../src/lib/agent-learning.js"
);
const { parseReplyReview, parsePendingReplyNeed, showsPurchaseIntent } = await import("../src/lib/openai-client.js");

type Sender = "contact" | "agent" | "bot";
let nextId = 1;
const msg = (sender: Sender, content: string) => ({
  id: nextId++,
  sender,
  type: "text" as const,
  content,
  mediaName: null,
  createdAt: new Date("2026-09-18T13:00:00Z"),
});

describe("agent-learning — pickReviewPair", () => {
  it("una frustración se compara con la última respuesta del bot, aunque el cliente haya escrito dos veces", () => {
    const bot = msg("bot", "Hola Ana, ¿en qué puedo ayudarte hoy?");
    const first = msg("contact", "???");
    const second = msg("contact", "ya te dije que ya me llegó");
    const rows = [msg("contact", "Gracias"), bot, first, second];
    assert.deepEqual(pickReviewPair(rows, second.id, "frustration"), { bot, reaction: second });
  });

  it("una corrección es la persona que entra justo detrás del bot", () => {
    const bot = msg("bot", "Hola Ana, ¿en qué puedo ayudarte hoy?");
    const human = msg("agent", "A usted las gracias");
    const rows = [msg("contact", "Gracias"), bot, human];
    assert.deepEqual(pickReviewPair(rows, human.id, "human_correction"), { bot, reaction: human });
  });

  it("si una persona ya había contestado, la reacción no es al bot", () => {
    const human = msg("agent", "Te mando la guía");
    const reaction = msg("contact", "no entiendo");
    const rows = [msg("bot", "¿En qué te ayudo?"), msg("contact", "mi pedido"), human, reaction];
    assert.equal(pickReviewPair(rows, reaction.id, "frustration"), null);
  });

  it("no revisa un mensaje que no corresponde a la señal", () => {
    const bot = msg("bot", "Procollagen US$100");
    const human = msg("agent", "Hola");
    assert.equal(pickReviewPair([bot, human], human.id, "frustration"), null);
    const contact = msg("contact", "ok");
    assert.equal(pickReviewPair([bot, contact], contact.id, "human_correction"), null);
  });

  it("sin respuesta del bot antes no hay nada que aprender", () => {
    const only = msg("contact", "Hola");
    assert.equal(pickReviewPair([only], only.id, "frustration"), null);
  });
});

describe("agent-learning — shouldAutoActivate", () => {
  it("una sugerida se activa sola cuando se repite en otra conversación", () => {
    assert.equal(LESSON_AUTO_ACTIVATE_CONVERSATIONS, 2);
    assert.equal(shouldAutoActivate("suggested", 1), false);
    assert.equal(shouldAutoActivate("suggested", 2), true);
  });

  it("lo que el equipo descartó no se reactiva solo", () => {
    assert.equal(shouldAutoActivate("dismissed", 10), false);
    assert.equal(shouldAutoActivate("active", 10), false);
  });
});

describe("openai-client — parseReplyReview", () => {
  it("lee el JSON del modelo y valida la lección existente contra las que hay", () => {
    const review = parseReplyReview(
      'Aquí va: {"flagged": true, "severity": "medium", "diagnosis": "Saludó como nuevo", "lesson": "Si el cliente agradece, cierra con cortesía.", "matchesLessonId": 7}',
      [7, 9],
    );
    assert.deepEqual(review, {
      flagged: true,
      severity: "medium",
      diagnosis: "Saludó como nuevo",
      lesson: "Si el cliente agradece, cierra con cortesía.",
      matchesLessonId: 7,
    });
  });

  it("descarta un id de lección que no existe", () => {
    const review = parseReplyReview('{"flagged": true, "severity": "low", "lesson": "Regla", "matchesLessonId": 99}', [7]);
    assert.equal(review?.matchesLessonId, null);
  });

  it("sin lección no marca nada", () => {
    const review = parseReplyReview('{"flagged": true, "severity": "high", "lesson": null}', []);
    assert.equal(review?.flagged, false);
  });

  it("devuelve null si el modelo no devolvió JSON", () => {
    assert.equal(parseReplyReview("no", []), null);
  });
});

describe("openai-client — parsePendingReplyNeed", () => {
  it("distingue contestar, cierre cortés y nada", () => {
    assert.equal(parsePendingReplyNeed("responder"), "answer");
    assert.equal(parsePendingReplyNeed("Cortesía"), "courtesy");
    assert.equal(parsePendingReplyNeed("cortesia."), "courtesy");
    assert.equal(parsePendingReplyNeed("nada"), "none");
    assert.equal(parsePendingReplyNeed(""), "none");
    assert.equal(parsePendingReplyNeed(null), "none");
  });
});

// A quien pregunta cómo comprar o dice que lo quiere, el enlace de la tienda le va
// aunque ya le hubiera llegado con la bienvenida.
describe("openai-client — showsPurchaseIntent", () => {
  it("reconoce cómo o dónde comprar, y el interés declarado", () => {
    for (const text of [
      "¿Cómo puedo comprar?",
      "como hago para pedirlo",
      "Me interesa su procollageno",
      "Hola, me interesa",
      "¿Dónde lo compro?",
      "quiero comprar el kit",
      "Lo quiero",
      // 2026-10-15: a estas también les va el mensaje de cómo comprar, que
      // empieza por el enlace.
      "¿Cómo se compra?",
      "como lo pido",
      "¿Cómo hago el pedido?",
      "como se hace el pedido",
    ]) {
      assert.equal(showsPurchaseIntent(text), true, text);
    }
  });

  it("no lo confunde con otras preguntas", () => {
    for (const text of ["¿Cuánto cuesta?", "Gracias", "¿Cuánto tarda el envío?", "¿Envían a Canadá?", "¿Cómo se toma?", "¿Cómo lo uso?"]) {
      assert.equal(showsPurchaseIntent(text), false, text);
    }
  });
});
