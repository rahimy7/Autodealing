import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseOptionButtons, OPTIONS_DIRECTIVE } = await import("../src/lib/openai-client.js");

describe("openai-client — parseOptionButtons", () => {
  it("turns the directive into buttons", () => {
    const buttons = parseOptionButtons("¿Es para interior o exterior? [[OPCIONES: Interior | Exterior]]");
    assert.deepEqual(
      buttons.map((b) => b.label),
      ["Interior", "Exterior"],
    );
    assert.deepEqual(
      buttons.map((b) => b.id),
      ["opt_0_interior", "opt_1_exterior"],
    );
  });

  it("returns nothing when there is no directive", () => {
    assert.deepEqual(parseOptionButtons("¿De qué color lo quieres?"), []);
  });

  it("keeps at most three options", () => {
    const buttons = parseOptionButtons("[[OPCIONES: Pared | Madera | Metal | Piso]]");
    assert.deepEqual(
      buttons.map((b) => b.label),
      ["Pared", "Madera", "Metal"],
    );
  });

  it("drops a single option: one button is not a choice", () => {
    assert.deepEqual(parseOptionButtons("[[OPCIONES: Interior]]"), []);
  });

  it("drops the whole set when a label does not fit the channel limit", () => {
    assert.deepEqual(parseOptionButtons("[[OPCIONES: Interior | Exterior con mucho sol y lluvia]]"), []);
  });

  it("counts emoji as one character each", () => {
    const buttons = parseOptionButtons("[[OPCIONES: 🏠 Interior | ☀️ Exterior]]");
    assert.deepEqual(
      buttons.map((b) => b.label),
      ["🏠 Interior", "☀️ Exterior"],
    );
  });

  it("strips bullets and numbering the model may drag in", () => {
    const buttons = parseOptionButtons("[[OPCIONES: 1. Sí | - No]]");
    assert.deepEqual(
      buttons.map((b) => b.label),
      ["Sí", "No"],
    );
  });

  it("ignores duplicates and blanks", () => {
    const buttons = parseOptionButtons("[[OPCIONES: Sí |  | sí | No]]");
    assert.deepEqual(
      buttons.map((b) => b.label),
      ["Sí", "No"],
    );
  });

  it("the directive is stripped from the visible text", () => {
    const reply = "¿Interior o exterior? [[OPCIONES: Interior | Exterior]]";
    assert.equal(reply.replace(OPTIONS_DIRECTIVE, "").trim(), "¿Interior o exterior?");
  });
});
