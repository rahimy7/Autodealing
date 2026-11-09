// El horario del programador en segundo plano (src/lib/scheduler-window.ts) y su
// gemelo del sitio de Premier (server/work-hours.js, en la raíz del proyecto): el
// sitio le pasa SCHEDULER_* a esta instancia, así que los dos tienen que dar las
// mismas vueltas o el sitio y Omnicanal despertarían la base a horas distintas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSchedulerWindow, schedulerSlot } from "../src/lib/scheduler-window";

const TZ = "America/New_York";
const premier = { SCHEDULER_DAYS: "1-5", SCHEDULER_HOURS: "09:00-17:00", SCHEDULER_INTERVAL_MINUTES: "60" };

// Ruta en variable: es JavaScript del sitio, fuera de este workspace de TypeScript.
const sitePath = new URL("../../../../server/work-hours.js", import.meta.url).href;
const site = (await import(sitePath)) as {
  workHours: (env: Record<string, string>, timeZone?: string) => unknown;
  workSlot: (window: unknown, now: Date) => string | null;
};

describe("horario del programador", () => {
  it("sin variables corre siempre, cada minuto", () => {
    assert.equal(parseSchedulerWindow({}, TZ), null);
  });

  it("lunes a viernes de 9:00 a 17:00, cada hora, en la hora del negocio", () => {
    const w = parseSchedulerWindow(premier, TZ)!;
    const slot = (iso: string) => schedulerSlot(w, new Date(iso));
    // Noviembre: hora estándar del este (UTC-5).
    assert.equal(slot("2026-11-09T14:00:30Z"), "2026-11-09 09:00");
    assert.equal(slot("2026-11-09T22:00:00Z"), "2026-11-09 17:00");
    assert.equal(slot("2026-11-09T13:00:00Z"), null, "8:00");
    assert.equal(slot("2026-11-09T23:00:00Z"), null, "18:00");
    assert.equal(slot("2026-11-09T14:30:00Z"), null, "solo en punto");
    assert.equal(slot("2026-11-14T15:00:00Z"), null, "sábado");
    assert.equal(slot("2026-11-15T15:00:00Z"), null, "domingo");
    // Julio: horario de verano (UTC-4), sigue siendo a las 9:00 locales.
    assert.equal(slot("2026-07-15T13:00:00Z"), "2026-07-15 09:00");
  });

  it("rechaza valores mal escritos", () => {
    for (const bad of [
      { SCHEDULER_DAYS: "lunes" },
      { SCHEDULER_DAYS: "5-1" },
      { SCHEDULER_HOURS: "9-5" },
      { SCHEDULER_HOURS: "17:00-09:00" },
      { SCHEDULER_HOURS: "09:00-17:00-18:00" },
      { SCHEDULER_INTERVAL_MINUTES: "0" },
      { SCHEDULER_INTERVAL_MINUTES: "media" },
    ])
      assert.throws(() => parseSchedulerWindow(bad, TZ), /inválido/, JSON.stringify(bad));
    assert.throws(() => parseSchedulerWindow(premier, "Marte/Olympus"));
  });

  it("da las mismas vueltas que el sitio de Premier, minuto a minuto, durante una semana", () => {
    for (const env of [premier, { SCHEDULER_DAYS: "1,3,6", SCHEDULER_HOURS: "08:30-12:30", SCHEDULER_INTERVAL_MINUTES: "45" }]) {
      const omni = parseSchedulerWindow(env, TZ)!;
      const web = site.workHours(env, TZ);
      let runs = 0;
      // Del domingo 8 al domingo 15 de noviembre de 2026, incluido el cambio de día en UTC.
      for (let t = Date.parse("2026-11-08T00:00:00Z"); t < Date.parse("2026-11-15T23:59:00Z"); t += 60_000) {
        const now = new Date(t);
        const a = schedulerSlot(omni, now);
        assert.equal(a, site.workSlot(web, now), now.toISOString());
        if (a) runs++;
      }
      if (env === premier) assert.equal(runs, 5 * 9, "nueve vueltas por día laborable");
    }
  });
});
