import { describe, it } from "node:test";
import assert from "node:assert/strict";

// El mapa de sucursales del core está declarado por id de cliente, y el único que
// lo tiene es "nicadom" (ver BRANCH_MAPS en src/lib/branches.ts). Esa
// configuración no viaja en esta copia, así que la prueba se identifica con ese id
// y una configuración mínima para seguir cubriendo el reparto por zona.
process.env.CLIENT_ID = "nicadom";
process.env.CLIENT_CONFIG_JSON = JSON.stringify({ name: "Sucursales de prueba" });

const { matchZone, matchZoneChoice, handoffNotice, handoffKindForProfile, defaultBranch, BRANCHES, ZONE_CHOICES, MAX_ZONE_ASKS } =
  await import("../src/lib/branches.js");

const groupOf = (text: string) => matchZone(text)?.branch.group ?? null;

describe("branches — matchZone", () => {
  it("reconoce la ciudad tal cual la escribe el cliente", () => {
    assert.equal(groupOf("Santiago"), "Tienda Santiago");
    assert.equal(groupOf("La Romana"), "Tienda Romana");
    assert.equal(groupOf("Bávaro"), "Tienda Bávaro");
  });

  it("ignora tildes, mayúsculas y puntuación", () => {
    assert.equal(groupOf("bavaro"), "Tienda Bávaro");
    assert.equal(groupOf("HIGÜEY!"), "Tienda Bávaro");
    assert.equal(groupOf("san francisco de macoris"), "Tienda Santiago");
  });

  it("encuentra la zona dentro de una frase", () => {
    assert.equal(groupOf("estoy en Los Alcarrizos, cerca del cruce"), "Tienda Serrallés");
    assert.equal(groupOf("vivo por Villa Duarte"), "Tienda Alma Rosa");
  });

  it("prefiere la zona más específica sobre la más general", () => {
    assert.equal(groupOf("Santo Domingo Este"), "Tienda Alma Rosa");
    assert.equal(groupOf("santo domingo norte"), "Tienda Serrallés");
    // "Santo Domingo" a secas es la capital: cae en el Distrito Nacional.
    assert.equal(groupOf("Santo Domingo"), "Tienda Serrallés");
  });

  it("no acepta coincidencias a medias dentro de otra palabra", () => {
    assert.equal(groupOf("maomeno por ahi"), null);
    assert.equal(groupOf("nacotienda"), null);
  });

  it("devuelve null cuando no hay zona reconocible", () => {
    assert.equal(matchZone(""), null);
    assert.equal(matchZone(null), null);
    assert.equal(matchZone("por allá arriba"), null);
    assert.equal(matchZone("quiero pintar una pared"), null);
  });

  it("devuelve la zona que hizo match, para guardarla en la ficha del contacto", () => {
    assert.equal(matchZone("estoy en punta cana")?.zone, "Punta Cana");
  });

  it("cada sucursal apunta a un grupo distinto y sin zonas repetidas", () => {
    const groups = BRANCHES.map((b) => b.group);
    assert.equal(new Set(groups).size, groups.length);

    const zones = BRANCHES.flatMap((b) => b.zones.map((z) => z.toLowerCase()));
    assert.equal(new Set(zones).size, zones.length, "una zona no puede pertenecer a dos tiendas");
  });

  it("cada sucursal tiene su etiqueta de localidad, única", () => {
    const slugs = BRANCHES.map((b) => b.localitySlug);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const branch of BRANCHES) {
      assert.match(branch.localitySlug, /^[a-z0-9-]+$/, `${branch.label}: el slug viaja en la etiqueta y en el id de la opción`);
    }
  });
});

describe("branches — elegir la tienda de la lista", () => {
  it("ofrece todas las sucursales, dentro de lo que admite una lista de WhatsApp", () => {
    assert.equal(ZONE_CHOICES.length, BRANCHES.length);
    assert.ok(ZONE_CHOICES.length <= 10, "WhatsApp no muestra más de 10 filas");
  });

  it("resuelve la sucursal por el id de la opción que tocó el cliente", () => {
    assert.equal(matchZoneChoice("zona:sucursal-santiago")?.branch.group, "Tienda Santiago");
    assert.equal(matchZoneChoice("zona:sucursal-bavaro")?.branch.group, "Tienda Bávaro");
  });

  it("ignora un id que no sea de esta lista", () => {
    assert.equal(matchZoneChoice(null), null);
    assert.equal(matchZoneChoice("opcion:interior"), null);
    assert.equal(matchZoneChoice("zona:sucursal-inventada"), null);
  });

  // El canal devuelve el título de la fila como texto. Tocar y escribir tienen que
  // llevar a la misma tienda, o el cliente que responde a mano acabaría en otra.
  it("tocar una opción equivale a escribir su nombre", () => {
    for (const choice of ZONE_CHOICES) {
      const tapped = matchZoneChoice(choice.id);
      const typed = matchZone(choice.label);
      assert.ok(tapped, `${choice.label}: el id no resuelve`);
      assert.ok(typed, `${choice.label}: el nombre de la tienda no está entre sus zonas`);
      assert.equal(typed.branch.group, tapped.branch.group);
    }
  });
});

describe("branches — a quién se traspasa", () => {
  // Nunca a un grupo genérico: al cliente lo atiende gente de una tienda, y quien
  // no llega a decir dónde está también acaba en una, no esperando a nadie.
  it("la sucursal de reserva existe y es una tienda de verdad", () => {
    const fallback = defaultBranch();
    assert.ok(BRANCHES.includes(fallback));
    assert.ok(fallback.group.startsWith("Tienda "));
  });

  it("se insiste con la zona antes de darla por perdida", () => {
    assert.ok(MAX_ZONE_ASKS >= 2, "una sola pregunta deja fuera a quien contesta algo raro la primera vez");
  });
});

describe("branches — aviso de traspaso", () => {
  it("dice que atiende una persona y en qué tienda", () => {
    const notice = handoffNotice("Santiago");
    assert.match(notice, /Santiago/);
    assert.match(notice, /asesor te atenderá en breve/);
  });

  it("no nombra tienda cuando no sabemos dónde está el cliente, pero sí que lo atenderán", () => {
    const notice = handoffNotice(null);
    assert.match(notice, /asesor te atenderá en breve/);
    for (const branch of BRANCHES) {
      assert.ok(!notice.includes(branch.label), `no debe nombrar ${branch.label}`);
    }
  });

  it("no promete tiempos que nadie garantizó", () => {
    for (const notice of [handoffNotice("Bávaro"), handoffNotice(null), handoffNotice(null, "order")]) {
      assert.doesNotMatch(notice, /\d+\s*(minuto|hora|min)/i);
    }
  });

  it("en un pedido confirmado habla del pedido, no de un asesor ni de la tienda", () => {
    const notice = handoffNotice("Santiago", "order");
    assert.match(notice, /pedido/i);
    assert.doesNotMatch(notice, /asesor|Santiago/);
  });

  it("sin avisos propios del cliente, ventas y servicio dicen lo mismo", () => {
    assert.equal(handoffNotice(null, "sales"), handoffNotice(null, "service"));
  });

  it("un cliente que no declara horario de fin de semana no cambia el sábado", () => {
    // El aviso de "próximo día laborable" es de quien atiende de lunes a viernes
    // (handoffNotices.weekend). Quien no lo declara atiende igual todos los días.
    const sabado = new Date("2026-09-19T16:00:00.000Z");
    assert.equal(handoffNotice(null, "service", sabado), handoffNotice(null, "service"));
    assert.equal(handoffNotice("Santiago", "sales", sabado), handoffNotice("Santiago", "sales"));
  });
});

describe("branches — motivo del traspaso", () => {
  it("los perfiles que venden avisan de ventas; el resto, de servicio", () => {
    for (const profile of ["sales", "winback", "qualifier"]) {
      assert.equal(handoffKindForProfile(profile), "sales", profile);
    }
    for (const profile of ["support", "postsale", "general", "reservations", null]) {
      assert.equal(handoffKindForProfile(profile), "service", String(profile));
    }
  });
});
