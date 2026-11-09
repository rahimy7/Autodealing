import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { speakingName } = await import("../src/lib/openai-client.js");

// En el panel conviene leer "Nico Ejecutivo de ventas"; al cliente le llega solo
// el nombre. Saber que le contesta "el de ventas" le anticipa que lo van a
// pasear de un área a otra, que es justo lo que el traspaso silencioso evita.
describe("speakingName", () => {
  it("quita el cargo pegado al nombre", () => {
    assert.equal(speakingName("Nico Ejecutivo de ventas"), "Nico");
    assert.equal(speakingName("Mateo Asistente para Citas"), "Mateo");
    assert.equal(speakingName("Sofía Asesora de color"), "Sofía");
  });

  it("quita lo que va tras la coma", () => {
    assert.equal(speakingName("Ana Isabel, Ejecutiva de Atencion y Servicio"), "Ana Isabel");
    assert.equal(speakingName("Lucía, IA"), "Lucía");
  });

  it("deja intacto un nombre que ya es solo nombre", () => {
    assert.equal(speakingName("Lucía"), "Lucía");
    assert.equal(speakingName("Ana Isabel"), "Ana Isabel");
    assert.equal(speakingName("  Mateo  "), "Mateo");
  });

  it("no se queda sin nombre cuando todo el nombre es un cargo", () => {
    assert.equal(speakingName("Asistente virtual"), "Asistente");
    assert.equal(speakingName("IA"), "IA");
  });
});
