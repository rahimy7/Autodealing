// Regla del 2026-09-20: un equipo que atiende de lunes a viernes. Una clienta que
// escribió el fin de semana recibió "en breve te estará atendiendo" y se pasó dos
// días esperando a alguien que no iba a entrar hasta el lunes. El aviso del fin de
// semana es de cada cliente; aquí se declara uno de prueba sobre Premier.
//
// Va en su propio archivo porque el aviso lo decide `clientConfig`, que se resuelve
// al importar: hay que fijar CLIENT_ID antes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.CLIENT_ID = "premier";
process.env.CLIENT_CONFIG_JSON = JSON.stringify({"business": {"handoffNotices": {"weekend": "Nuestro equipo atiende de lunes a viernes: te escribirá el próximo día laborable. 🙌"}}});
process.env.APP_TIMEZONE = "America/Santo_Domingo";

const { handoffNotice } = await import("../src/lib/branches.js");

const SABADO = new Date("2026-09-19T16:00:00.000Z");
const DOMINGO = new Date("2026-09-20T16:00:00.000Z");
const LUNES = new Date("2026-09-21T16:00:00.000Z");
const VIERNES_DE_NOCHE = new Date("2026-09-19T01:00:00.000Z"); // 21:00 del viernes en RD

describe("aviso de traspaso en fin de semana", () => {
  it("el sábado y el domingo remite al próximo día laborable", () => {
    for (const [dia, fecha] of [
      ["sábado", SABADO],
      ["domingo", DOMINGO],
    ] as const) {
      for (const kind of ["sales", "service"] as const) {
        const notice = handoffNotice(null, kind, fecha);
        assert.match(notice, /día laborable/i, `${dia} / ${kind}`);
        assert.doesNotMatch(notice, /en breve/i, `${dia} / ${kind}`);
      }
    }
  });

  it("entre semana sigue diciendo lo de siempre", () => {
    assert.match(handoffNotice(null, "sales", LUNES), /en breve/i);
    assert.match(handoffNotice(null, "service", LUNES), /en breve/i);
    assert.doesNotMatch(handoffNotice(null, "service", LUNES), /día laborable/i);
  });

  it("el viernes por la noche todavía es día laborable, aunque en UTC ya sea sábado", () => {
    assert.equal(VIERNES_DE_NOCHE.getUTCDay(), 6);
    assert.match(handoffNotice(null, "service", VIERNES_DE_NOCHE), /en breve/i);
  });

  it("un pedido confirmado no cambia: no promete atención, confirma la compra", () => {
    const notice = handoffNotice(null, "order", SABADO);
    assert.match(notice, /pedido/i);
    assert.doesNotMatch(notice, /día laborable/i);
  });

  it("el aviso del fin de semana no promete un tiempo que nadie garantizó", () => {
    const notice = handoffNotice(null, "service", SABADO);
    assert.doesNotMatch(notice, /\d+\s*(minuto|hora|min)/i);
  });
});
