import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseLocalDateTime } = await import("../src/lib/time.js");
const { parseAppointmentDirective } = await import("../src/lib/openai-client.js");
const { endOf } = await import("../src/lib/appointments.js");
const { buildReminderText, formatReminderWhen } = await import("../src/lib/appointment-reminders.js");

// Las instancias de prueba viven en America/Santo_Domingo (UTC-4 todo el año),
// así que las horas esperadas son fijas y no dependen de la máquina.
describe("citas — hora de reloj del negocio", () => {
  it("interpreta la hora en la zona del cliente, no en UTC", () => {
    // Si esto se leyera como UTC, la cita caería a las 11:00 de la mañana.
    assert.equal(parseLocalDateTime("2026-08-15 15:00")?.toISOString(), "2026-08-15T19:00:00.000Z");
  });

  it("acepta la T de separador y la hora sin cero delante", () => {
    assert.equal(parseLocalDateTime("2026-08-15T09:30")?.toISOString(), "2026-08-15T13:30:00.000Z");
    assert.equal(parseLocalDateTime("2026-08-15 9:30")?.toISOString(), "2026-08-15T13:30:00.000Z");
  });

  it("cruza bien la medianoche local", () => {
    // 23:30 del 15 en Santo Domingo ya es el 16 en UTC.
    assert.equal(parseLocalDateTime("2026-08-15 23:30")?.toISOString(), "2026-08-16T03:30:00.000Z");
  });

  it("rechaza lo que no es una fecha con hora", () => {
    for (const bad of ["mañana a las 3", "2026-08-15", "15/08/2026 15:00", "", "2026-13-40 99:99"]) {
      assert.equal(parseLocalDateTime(bad), null, `debería rechazar ${JSON.stringify(bad)}`);
    }
  });
});

describe("citas — marca del agente virtual", () => {
  it("lee servicio, fecha y lugar", () => {
    const parsed = parseAppointmentDirective(
      "Listo, te espero el sábado. [[CITA: Corte de cabello | 2026-08-15 15:00 | Sucursal Naco]]",
    );
    assert.deepEqual(parsed, {
      service: "Corte de cabello",
      when: "2026-08-15 15:00",
      location: "Sucursal Naco",
    });
  });

  it("el lugar es opcional", () => {
    const parsed = parseAppointmentDirective("Agendado. [[CITA: Asesoría | 2026-08-15 15:00]]");
    assert.equal(parsed?.location, null);
    assert.equal(parsed?.service, "Asesoría");
  });

  it("no agenda con datos a medias", () => {
    // Sin fecha no hay cita que crear: mejor ninguna que una inventada.
    assert.equal(parseAppointmentDirective("[[CITA: Corte de cabello]]"), null);
    assert.equal(parseAppointmentDirective("[[CITA: | 2026-08-15 15:00]]"), null);
  });

  it("devuelve null cuando el agente no agendó nada", () => {
    assert.equal(parseAppointmentDirective("¿Qué día te queda mejor?"), null);
  });
});

describe("citas — recordatorio", () => {
  // 19:00Z son las 3:00 p. m. en Santo Domingo. Se comprueba por partes y no con
  // la cadena exacta porque el separador y el formato de "p. m." cambian entre
  // versiones de ICU.
  const startsAt = new Date("2026-08-15T19:00:00.000Z");

  it("dice el día y la hora en la zona del negocio", () => {
    const when = formatReminderWhen(startsAt, "America/Santo_Domingo");
    assert.match(when, /sábado/);
    assert.match(when, /15 de agosto/);
    assert.match(when, /3:00/);
  });

  it("saluda por el nombre de pila y menciona el lugar", () => {
    const text = buildReminderText({
      contactName: "Ana Pérez",
      service: "Sesión de entrenamiento",
      startsAt,
      location: "Vibe Center Naco",
    });
    assert.match(text, /^Hola Ana, /);
    assert.match(text, /Sesión de entrenamiento/);
    assert.match(text, /en Vibe Center Naco/);
  });

  it("funciona sin nombre y sin lugar", () => {
    const text = buildReminderText({
      contactName: null,
      service: "Asesoría",
      startsAt,
      location: null,
    });
    assert.match(text, /^Te recordamos tu cita de Asesoría/);
    assert.doesNotMatch(text, / en null/);
  });
});

describe("citas — fin de la cita", () => {
  it("suma la duración al inicio", () => {
    const startsAt = new Date("2026-08-15T19:00:00.000Z");
    assert.equal(
      endOf({ startsAt, durationMinutes: 90 }).toISOString(),
      "2026-08-15T20:30:00.000Z",
    );
  });
});
