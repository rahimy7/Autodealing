import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";
process.env.CLIENT_ID = "premier";

const { buildSystemPrompt } = await import("../src/lib/openai-client.js");

const base = { agentName: "Sofía", customPrompt: null, profileType: "support" };
const session = {
  now: new Date("2026-09-18T13:13:00Z"),
  startedAt: new Date("2026-09-18T13:13:00Z"),
};

// 2026-09-18: a una clienta el equipo le mandó la guía del envío, contestó "Gracias" y el bot
// le preguntó "¿en qué puedo ayudarte hoy?". A otra le mandaron el
// formato del pedido, contestó a qué hora podía recibir, y le salió lo mismo.
describe("conducta — lo que no pide nada se cierra con cortesía", () => {
  it("todos los agentes saben cerrar con cortesía sin preguntar en qué ayudar", () => {
    for (const profileType of ["sales", "support", "general", "winback", "postsale"]) {
      const prompt = buildSystemPrompt({ ...base, profileType });
      assert.match(prompt, /Si el cliente no pide nada/, profileType);
      assert.match(prompt, /Siempre a la orden/, profileType);
      assert.match(prompt, /No le preguntes en qué puedes ayudarle ni le ofrezcas nada/, profileType);
      assert.match(prompt, /mira dónde quedó la conversación, incluido lo que le mandó una persona del equipo/, profileType);
    }
  });

  it("una conversación nueva sigue saludando, pero no a quien contesta lo último que se le dijo", () => {
    const prompt = buildSystemPrompt({ ...base, session: { ...session, isNew: true } });
    assert.match(prompt, /Salúdalo y pregúntale en qué puede ayudarle hoy/);
    assert.match(prompt, /Excepción: si su mensaje contesta a lo último que se le dijo antes/);
  });
});

describe("conducta — lo último antes de esta conversación", () => {
  it("le enseña al agente a qué responde el cliente", () => {
    const prompt = buildSystemPrompt({
      ...base,
      session: { ...session, isNew: true },
      previousTail: "[18/09 09:12] Persona del equipo: 📷 Imagen\n[18/09 09:12] Persona del equipo: Si",
    });
    assert.match(prompt, /ÚLTIMOS MENSAJES ANTES DE ESTA CONVERSACIÓN/);
    assert.match(prompt, /Persona del equipo: 📷 Imagen/);
  });

  it("sin mensajes anteriores no agrega el bloque", () => {
    assert.doesNotMatch(buildSystemPrompt(base), /ÚLTIMOS MENSAJES ANTES/);
  });
});

describe("conducta — memoria de aprendizaje", () => {
  it("las lecciones activas van al prompt, sin mandar sobre las reglas del negocio", () => {
    const prompt = buildSystemPrompt({
      ...base,
      lessons: ["Si el cliente agradece algo que le envió el equipo, cierra con cortesía."],
    });
    assert.match(prompt, /APRENDIZAJES DE CONVERSACIONES REALES/);
    assert.match(prompt, /- Si el cliente agradece algo que le envió el equipo, cierra con cortesía\./);
    assert.match(prompt, /mandan tus instrucciones/);
  });

  it("sin lecciones no hay bloque", () => {
    assert.doesNotMatch(buildSystemPrompt({ ...base, lessons: [] }), /APRENDIZAJES/);
  });
});
