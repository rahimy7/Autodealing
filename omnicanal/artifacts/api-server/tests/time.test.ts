import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";

const { formatShort, formatDay, humanizeGap, localWeekday, isWeekend } = await import("../src/lib/time.js");

describe("time — local formatting", () => {
  it("renders timestamps in the business timezone, not UTC", () => {
    // 03:30 UTC is still the previous evening (23:30) in Santo Domingo (UTC-4).
    const date = new Date("2026-07-24T03:30:00.000Z");
    assert.equal(formatShort(date), "23/07 23:30");
    assert.equal(formatDay(date), "23/07");
  });

  it("keeps the same calendar day when the offset does not cross midnight", () => {
    const date = new Date("2026-07-23T16:55:00.000Z");
    assert.equal(formatDay(date), "23/07");
  });
});

describe("time — humanizeGap", () => {
  it("describes sub-minute gaps as seconds", () => {
    assert.equal(humanizeGap(20_000), "hace unos segundos");
  });

  it("uses singular and plural correctly", () => {
    assert.equal(humanizeGap(60_000), "hace 1 minuto");
    assert.equal(humanizeGap(5 * 60_000), "hace 5 minutos");
    assert.equal(humanizeGap(60 * 60_000), "hace 1 hora");
    assert.equal(humanizeGap(3 * 60 * 60_000), "hace 3 horas");
  });

  it("switches to days past 24 hours", () => {
    assert.equal(humanizeGap(24 * 60 * 60_000), "hace 1 día");
    assert.equal(humanizeGap(7 * 24 * 60 * 60_000), "hace 7 días");
  });
});

describe("time — fin de semana del negocio", () => {
  // El equipo atiende de lunes a viernes, y el aviso de traspaso cambia el fin de
  // semana: si el día se leyera en UTC, un viernes por la noche en Santo Domingo
  // ya sería sábado y al cliente se le diría que nadie lo atiende hasta el lunes.
  it("un viernes por la noche en Santo Domingo sigue siendo viernes", () => {
    const viernes2100 = new Date("2026-09-19T01:00:00.000Z");
    assert.equal(viernes2100.getUTCDay(), 6, "en UTC ya es sábado");
    assert.equal(localWeekday(viernes2100), 5);
    assert.equal(isWeekend(viernes2100), false);
  });

  it("un domingo por la noche en Santo Domingo sigue siendo domingo", () => {
    const domingo2100 = new Date("2026-09-21T01:00:00.000Z");
    assert.equal(domingo2100.getUTCDay(), 1, "en UTC ya es lunes");
    assert.equal(localWeekday(domingo2100), 0);
    assert.equal(isWeekend(domingo2100), true);
  });

  it("sábado y domingo son fin de semana; de lunes a viernes no", () => {
    assert.equal(isWeekend(new Date("2026-09-19T16:00:00.000Z")), true, "sábado");
    assert.equal(isWeekend(new Date("2026-09-20T16:00:00.000Z")), true, "domingo");
    for (const dia of ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]) {
      assert.equal(isWeekend(new Date(`${dia}T16:00:00.000Z`)), false, dia);
    }
  });
});
