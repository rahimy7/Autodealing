import { describe, it } from "node:test";
import assert from "node:assert/strict";

// answer-training pulls in @workspace/db, which refuses to load without a
// connection string. Nothing here touches the pool — only the pure logic.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
process.env.CLIENT_ID = "premier";

const { parseKnowledgeQuestions, normalizeQuestionKey, answerText, indicationsInstruction } = await import(
  "../src/lib/answer-training.js"
);
const { buildSystemPrompt } = await import("../src/lib/openai-client.js");

describe("answer-training — preguntas de la base de conocimiento", () => {
  const faq = [
    "# Preguntas frecuentes — Procollagen Vital Essence",
    "",
    "Lo que más preguntan los clientes. **Ojo:** los precios están en el catálogo.",
    "",
    "## Comprar",
    "",
    "**¿Cómo puedo comprar?**",
    "Se responde con este mensaje, tal cual.",
    "",
    "**¿Tienen combo o kit?**",
    "Sí: el kit de los tres productos.",
    "",
    // catalog-docs corta a 80 columnas: la pregunta sigue en la línea de abajo.
    "**¿Hacen descuento si compro varios? Quiero revender o",
    "promocionar la marca.**",
    "Lo atiende una persona del equipo.",
    "",
    "## Envíos",
    "",
    "**¿Envían a la casa?**",
    "Enviamos a su casa si vive en el Distrito Nacional o Santo Domingo Oeste.",
    "**Importante**",
    "Esto no es una pregunta.",
  ].join("\n");

  it("saca cada pregunta con su categoría, incluida la que ocupa dos líneas", () => {
    assert.deepEqual(parseKnowledgeQuestions(faq), [
      { question: "¿Cómo puedo comprar?", category: "Comprar" },
      { question: "¿Tienen combo o kit?", category: "Comprar" },
      { question: "¿Hacen descuento si compro varios? Quiero revender o promocionar la marca.", category: "Comprar" },
      { question: "¿Envían a la casa?", category: "Envíos" },
    ]);
  });

  it("no confunde una negrita dentro de una línea ni un título en negrita con una pregunta", () => {
    const questions = parseKnowledgeQuestions(faq).map((q) => q.question);
    assert.ok(!questions.some((q) => q.includes("Ojo") || q.includes("Importante")));
  });

  it("reconoce la misma pregunta escrita distinto", () => {
    assert.equal(normalizeQuestionKey("¿Cómo puedo comprar?"), normalizeQuestionKey("como puedo COMPRAR"));
    assert.notEqual(normalizeQuestionKey("¿Envían a la casa?"), normalizeQuestionKey("¿Envían a Canadá?"));
  });
});

describe("answer-training — la respuesta como la vería el cliente", () => {
  it("quita las marcas, la hora copiada del historial y la palabra de escalar", () => {
    const raw = "[15/10 16:43] Te lo envío gratis 🙌\n[[IMAGEN:como-comprar]] [[FOTO:procollagen]]\n[[OPCIONES: Sí | No]]";
    assert.equal(answerText(raw, null), "Te lo envío gratis 🙌");
    assert.equal(answerText("ESCALAR_A_HUMANO", null), "");
  });

  it("sin tasa del día, un monto en pesos sale en dólares en vez de inventarse", () => {
    assert.match(answerText("Son [[PESOS: 100]]", null), /US\$\s?100/);
  });
});

describe("answer-training — lo que lee el agente", () => {
  it("las indicaciones del equipo llevan la respuesta anterior para corregirla", () => {
    const text = indicationsInstruction("Más corto y con el precio.", "Hola, el Procollagen cuesta US$100 y tiene muchos beneficios…");
    assert.match(text, /INDICACIONES DEL EQUIPO PARA ESTA RESPUESTA/);
    assert.match(text, /Más corto y con el precio\./);
    assert.match(text, /Tu respuesta anterior fue esta:\n«Hola, el Procollagen cuesta US\$100/);
    assert.doesNotMatch(indicationsInstruction("Más corto.", null), /respuesta anterior/);
  });

  it("las respuestas aprobadas van en el prompt, delante de los aprendizajes", () => {
    const prompt = buildSystemPrompt({
      agentName: "Daniela",
      profileType: "sales",
      customPrompt: null,
      lessons: ["No preguntes la edad."],
      guides: [{ question: "¿Hacen envíos a Santiago?", instruction: "Di que sí, gratis, en 2 a 3 días hábiles." }],
    });
    assert.match(prompt, /RESPUESTAS APROBADAS POR EL EQUIPO/);
    assert.match(prompt, /- Si preguntan «¿Hacen envíos a Santiago\?» \(o algo equivalente\): Di que sí, gratis, en 2 a 3 días hábiles\./);
    assert.match(prompt, /escríbelo sin las comillas/);
    assert.ok(prompt.indexOf("RESPUESTAS APROBADAS") < prompt.indexOf("APRENDIZAJES DE CONVERSACIONES REALES"));
  });

  it("sin respuestas aprobadas no aparece el bloque", () => {
    assert.doesNotMatch(buildSystemPrompt({ agentName: "Daniela", profileType: "sales", customPrompt: null }), /RESPUESTAS APROBADAS/);
  });
});
