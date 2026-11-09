// Zona del cliente → tienda que le queda más cerca. El equipo humano está
// repartido por sucursal (un grupo de agentes por tienda, ver
// scripts/create-store-groups.ts), así que antes de pasarle una conversación a
// una persona hay que saber desde dónde escribe.
//
// Este archivo es el diccionario de zonas: qué sectores cubre cada tienda. A
// QUIÉN se le entrega la conversación NO se decide aquí, sino en el flujo: cada
// sucursal tiene su etiqueta de localidad y el flujo activo dice a qué grupo va
// esa etiqueta (scripts/setup-locality-routing.ts lo deja montado). Así abrir una
// tienda o mover un equipo se hace desde el panel y no tocando código; el nombre
// de grupo de aquí abajo solo queda como red de seguridad para cuando el flujo
// todavía no tiene esa etiqueta cableada.
//
// El mapa es una decisión comercial, no geografía exacta: se edita aquí cuando
// abra una tienda o cambie la cobertura de una zona.

import { clientConfig } from "./client-config";
import { isWeekend } from "./time";

export type Branch = {
  // Nombre exacto del grupo en agent_groups. Solo se usa si el flujo activo no
  // dice nada sobre la etiqueta de esta sucursal.
  group: string;
  // Cómo se le nombra la tienda al cliente.
  label: string;
  // Etiqueta de localidad que representa a esta sucursal en el flujo.
  localityLabel: string;
  localitySlug: string;
  // Ciudades, provincias y sectores que atiende. Se escriben como se leen (con
  // tildes); la comparación normaliza por su cuenta.
  zones: string[];
};

// Un mapa de sucursales por cliente. Antes era una lista única con las tiendas
// de NicaDom, y como este archivo es código compartido, CUALQUIER instancia que
// escalara a un grupo humano le preguntaba al cliente por sectores de Santo
// Domingo Este que no tienen nada que ver con ella.
//
// Un cliente sin mapa declarado no tiene reparto por sucursal: se le entrega la
// conversación al grupo directamente, sin preguntarle dónde está. Ese es el
// caso normal —un solo local— y además evita que una instancia nueva herede la
// geografía de otra por descuido.
const BRANCH_MAPS: Record<string, { branches: Branch[]; defaultSlug: string }> = {
  nicadom: {
    defaultSlug: "sucursal-serralles",
    branches: [
  {
    group: "Tienda Alma Rosa",
    label: "Alma Rosa",
    localityLabel: "Sucursal Alma Rosa",
    localitySlug: "sucursal-alma-rosa",
    zones: [
      "Santo Domingo Este",
      "Alma Rosa",
      "Los Mina",
      "San Isidro",
      "Villa Duarte",
      "Ozama",
      "Sabana Perdida",
      "Cancino",
      "Invivienda",
      "Los Frailes",
      "Mendoza",
      "Brisa Oriental",
      "Boca Chica",
      "La Caleta",
      "Andrés",
      "San Luis",
      "Las Américas",
    ],
  },
  {
    group: "Tienda Serrallés",
    label: "Serrallés",
    localityLabel: "Sucursal Serrallés",
    localitySlug: "sucursal-serralles",
    zones: [
      // "Santo Domingo" a secas es ambiguo (la capital tiene dos tiendas): se
      // resuelve al Distrito Nacional, que es la más céntrica. Los sectores del
      // este ganan por ser más específicos — ver matchZone.
      "Santo Domingo",
      "Distrito Nacional",
      "Santo Domingo Norte",
      "Santo Domingo Oeste",
      "Serrallés",
      "Naco",
      "Piantini",
      "Bella Vista",
      "Evaristo Morales",
      "Gazcue",
      "Zona Colonial",
      "Ciudad Nueva",
      "Arroyo Hondo",
      "Los Prados",
      "La Julia",
      "El Millón",
      "Los Cacicazgos",
      "Mirador Sur",
      "Mirador Norte",
      "El Vergel",
      "Villa Consuelo",
      "San Carlos",
      "Villa Mella",
      "Los Alcarrizos",
      "Herrera",
      "Pantoja",
      "Manoguayabo",
      "Bayona",
      "Engombe",
      "Capital",
    ],
  },
  {
    group: "Tienda Santiago",
    label: "Santiago",
    localityLabel: "Sucursal Santiago",
    localitySlug: "sucursal-santiago",
    zones: [
      "Santiago",
      "Cibao",
      "La Vega",
      "Moca",
      "Puerto Plata",
      "San Francisco de Macorís",
      "Bonao",
      "Jarabacoa",
      "Constanza",
      "Cotuí",
      "Salcedo",
      "Tenares",
      "Navarrete",
      "Licey",
      "Tamboril",
      "Villa González",
      "Esperanza",
      "Mao",
      "Valverde",
      "Sabaneta",
      "Dajabón",
      "Montecristi",
      "Sosúa",
      "Cabarete",
      "Nagua",
      "Samaná",
      "Las Terrenas",
    ],
  },
  {
    group: "Tienda Romana",
    label: "La Romana",
    localityLabel: "Sucursal La Romana",
    localitySlug: "sucursal-la-romana",
    zones: [
      "La Romana",
      "Romana",
      "San Pedro de Macorís",
      "San Pedro",
      "Guaymate",
      "Bayahíbe",
      "Casa de Campo",
      "Consuelo",
      "Quisqueya",
      "Hato Mayor",
      "El Seibo",
    ],
  },
  {
    group: "Tienda Bávaro",
    label: "Bávaro",
    localityLabel: "Sucursal Bávaro",
    localitySlug: "sucursal-bavaro",
    zones: [
      "Bávaro",
      "Punta Cana",
      "Verón",
      "Higüey",
      "Salvaleón de Higüey",
      "Uvero Alto",
      "El Cortecito",
      "Cap Cana",
      "Macao",
      "Friusa",
      "Cabeza de Toro",
    ],
  },
],
  },
};

const activeMap = BRANCH_MAPS[clientConfig.id] ?? null;

export const BRANCHES: Branch[] = activeMap?.branches ?? [];

/**
 * ¿Esta instancia reparte por sucursal? Cuando no, la escalación va derecha al
 * grupo humano y al cliente no se le pregunta la zona: preguntársela teniendo un
 * solo local es pedirle un dato que no cambia nada.
 */
export function hasBranchRouting(): boolean {
  return BRANCHES.length > 0;
}

// Pregunta que se le hace al cliente cuando no sabemos de dónde escribe. Va con
// las tiendas como opciones tocables (ver deliverChoiceMessage): al cliente no le
// gusta escribir, y una sucursal elegida a dedo es más fiable que un sector
// tecleado a mano. Quien prefiera escribir su zona igual funciona: matchZone lee
// la respuesta libre.
export const ZONE_QUESTION =
  "Para pasarte con un asesor te ubico primero: ¿en qué zona estás o en cuál tienda prefieres que te atiendan?";

// Segundo intento, cuando lo que contestó no cayó en ninguna zona conocida. No se
// insiste con la misma frase: se le pide que elija la tienda de la lista, que es
// una respuesta que no puede fallar.
export const ZONE_QUESTION_RETRY =
  "No logré ubicar esa zona. Elige la tienda donde prefieres que te atiendan y te paso con un asesor de ahí.";

// Cuántas veces se le pregunta antes de dejar de insistir. Dos: la segunda ya va
// con la lista por delante, y una tercera solo enfadaría a quien está esperando.
export const MAX_ZONE_ASKS = 2;

// Instrucción corta que WhatsApp muestra en el botón que abre la lista.
export const ZONE_CHOICE_ACTION = "Ver tiendas";

export type ZoneChoice = { id: string; label: string; description: string };

// Las opciones que ve el cliente. El id viaja de vuelta cuando toca una, así que
// no depende de cómo esté escrito el texto; el título es el nombre de la tienda,
// que además está en su lista de zonas y por eso matchZone lo reconoce igual.
export const ZONE_CHOICES: ZoneChoice[] = BRANCHES.map((branch) => ({
  id: `zona:${branch.localitySlug}`,
  label: branch.label,
  // Las 3 primeras zonas dan una pista de cobertura sin convertirlo en un listado.
  description: branch.zones.slice(0, 3).join(", "),
}));

// La sucursal que el cliente eligió tocando una opción. Se resuelve por id para
// no depender del texto que el canal devuelva.
export function matchZoneChoice(buttonId: string | null | undefined): BranchMatch | null {
  if (!buttonId?.startsWith("zona:")) return null;
  const slug = buttonId.slice("zona:".length);
  const branch = BRANCHES.find((b) => b.localitySlug === slug);
  return branch ? { branch, zone: branch.label } : null;
}

// La tienda a la que va quien no llegó a decir dónde está. Nunca se traspasa a un
// grupo sin gente: la conversación acaba en una sucursal de verdad. La capital es
// la de mayor cobertura y desde ahí se puede reencaminar a quien haga falta.
export function defaultBranch(): Branch {
  const slug = activeMap?.defaultSlug;
  const branch = slug ? BRANCHES.find((b) => b.localitySlug === slug) : undefined;
  if (!branch) {
    throw new Error(
      `branches: "${clientConfig.id}" no tiene sucursal de reserva. ` +
        "Solo debe llegarse aquí con hasBranchRouting() en true.",
    );
  }
  return branch;
}

// Por qué pasa la conversación a una persona, que es lo que decide el aviso:
//   - "sales" / "service": el agente virtual no supo o el tema no le tocaba. Se
//     distinguen porque hay negocios que le dicen al cliente qué equipo lo atiende.
//   - "order": el cliente cerró un pedido y dice haber pagado (PEDIDO_CONFIRMADO).
//     Lo que espera oír es que su pedido va, no que "un asesor lo atenderá".
export type HandoffKind = "sales" | "service" | "order";

const SALES_PROFILES = new Set(["sales", "winback", "qualifier"]);

export function handoffKindForProfile(profileType: string | null | undefined): HandoffKind {
  return SALES_PROFILES.has(profileType ?? "") ? "sales" : "service";
}

// Aviso de traspaso. El cliente sabe que a partir de aquí le escribe una persona:
// lo manda el sistema y no el modelo, para que el texto sea siempre el mismo y no
// se inventen promesas de tiempo ni de disponibilidad.
//
// Sin nombre de tienda cuando no sabemos dónde está: la conversación igual va a
// una sucursal, pero nombrársela sería decirle que le queda cerca cuando no lo
// sabemos.
//
// Cada cliente puede fijar su texto por motivo (business.handoffNotices); el del
// core es neutro. La tienda, cuando se sabe, manda sobre ese texto en ventas y
// servicio porque es el dato que el cliente necesita; en un pedido no se nombra,
// porque lo que se le confirma es el pedido.
//
// En sábado o domingo, un negocio que atiende de lunes a viernes dice otra cosa
// (regla del 2026-09-20): prometer "en breve" un sábado es prometer algo que no
// va a pasar, y el cliente se queda el fin de semana esperando. Solo si el
// cliente declaró `handoffNotices.weekend`; sin eso, nada cambia. El aviso de
// pedido no se toca: no promete atención, confirma la compra.
export function handoffNotice(
  branchLabel: string | null,
  kind: HandoffKind = "service",
  now: Date = new Date(),
): string {
  const notices = clientConfig.business.handoffNotices;
  const custom = notices[kind];
  if (kind === "order") return custom ?? "¡Gracias! Recibimos tu pedido y nuestro equipo ya lo está procesando. 🙌";
  if (notices.weekend && isWeekend(now)) return notices.weekend;
  if (branchLabel) return `Te paso con nuestra tienda de ${branchLabel}: un asesor te atenderá en breve. 🙌`;
  return custom ?? "Te paso con nuestro equipo: un asesor te atenderá en breve. 🙌";
}

// Marca interna de que ya se preguntó: sin ella, un cliente que responde algo que
// no está en el mapa ("vivo por allá arriba") se quedaría dando vueltas en la
// misma pregunta en lugar de llegar a una persona.
export const ZONE_ASKED_NOTE = "📍 Se le preguntó la zona al cliente para asignarle la tienda más cercana.";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Zonas ordenadas de más específica a menos, para que "Santo Domingo Este" gane
// sobre "Santo Domingo" cuando el cliente escribe la primera.
const ZONE_INDEX: Array<{ branch: Branch; zone: string; needle: string }> = BRANCHES.flatMap((branch) =>
  branch.zones.map((zone) => ({ branch, zone, needle: normalize(zone) })),
).sort((a, b) => b.needle.length - a.needle.length);

export type BranchMatch = { branch: Branch; zone: string };

// Busca en un texto libre (lo que escribió el cliente, su ciudad o su dirección)
// la primera zona reconocible. Devuelve también la zona que hizo match, que es lo
// que se guarda como ciudad del contacto.
export function matchZone(text: string | null | undefined): BranchMatch | null {
  if (!text) return null;
  const haystack = ` ${normalize(text)} `;
  for (const entry of ZONE_INDEX) {
    // Con espacios alrededor para no dar por buena una coincidencia a medias
    // ("Mao" dentro de "Maoquería").
    if (haystack.includes(` ${entry.needle} `)) return { branch: entry.branch, zone: entry.zone };
  }
  return null;
}
