import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";

const { generateKnowledgeQuestion } = await import("../src/lib/openai-client.js");

// The test env has no AI_INTEGRATIONS_OPENAI_API_KEY, so every call here takes
// the "AI unavailable" fallback branch — the same branch a real instance falls
// back to when the key is missing or OpenAI is unreachable. It's the only branch
// that's deterministic to test without a live model.
describe("generateKnowledgeQuestion — AI unavailable fallback", () => {
  it("keeps the question unchanged and reports it did not improve anything", async () => {
    const result = await generateKnowledgeQuestion({ question: "  envio a domicilio?  " });
    assert.equal(result.ok, false);
    assert.equal(result.question, "envio a domicilio?");
    assert.match(result.message ?? "", /IA no está configurada/);
  });

  it("suggests the first existing category instead of inventing one", () => {
    return generateKnowledgeQuestion({ question: "cuanto cuesta", categories: ["Precios", "Envíos"] }).then((result) => {
      assert.equal(result.category, "Precios");
    });
  });

  it("falls back to 'General' when the knowledge base has no categories yet", async () => {
    const result = await generateKnowledgeQuestion({ question: "cuanto cuesta", categories: [] });
    assert.equal(result.category, "General");
  });
});
