// Lee y escribe el `content` de una base de conocimiento como preguntas y
// respuestas agrupadas por categoría, en el mismo formato Markdown que ya usan
// los documentos de preguntas frecuentes generados por scripts/catalog-docs.ts:
//
//   ## Categoría
//
//   **¿Pregunta?**
//   Respuesta, en una o varias líneas.
//
// El editor de la base de conocimiento trabaja con esta forma estructurada;
// `content` sigue siendo el único texto que el agente lee, así que nada cambia
// del lado del servidor. Un documento que no sigue este formato (texto libre,
// con encabezados y párrafos normales) no pierde nada al pasar por aquí: lo que
// no encaja como pregunta se conserva tal cual, con su encabezado, y se vuelve a
// escribir al guardar — al final del documento en vez de en su lugar original,
// que es el único costo de editarlo en modo preguntas y respuestas.

export type QaItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
};

export type ParsedKnowledge = {
  /** Todo lo que aparece antes de la primera categoría o pregunta (un título, una introducción). */
  preamble: string;
  items: QaItem[];
  /**
   * Secciones o líneas que no encajaron como pregunta (una categoría sin
   * preguntas, una lista de viñetas). Se conservan íntegras y se vuelven a
   * escribir al final para no perder nada que el documento ya traía.
   */
  extras: string;
};

let seq = 0;
function makeId(): string {
  seq += 1;
  return `qa-${Date.now()}-${seq}`;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;
const QUESTION_RE = /^\*\*(.+?)\*\*$/;

export function parseKnowledgeContent(content: string): ParsedKnowledge {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  // El preámbulo es todo lo anterior a la primera categoría o pregunta: un
  // título, una línea de introducción. Ahí termina y empieza el documento
  // propiamente estructurado.
  let i = 0;
  while (i < lines.length && !HEADING_RE.test(lines[i]) && !QUESTION_RE.test(lines[i].trim())) i++;
  const preamble = lines.slice(0, i).join("\n").trim();

  const items: QaItem[] = [];
  const extraBlocks: string[] = [];

  // De ahí en adelante el documento es una sucesión de "tramos": cada uno
  // empieza en un encabezado `##` (o, si no hay ninguno antes de la primera
  // pregunta, es un tramo implícito sin categoría) y dura hasta el siguiente
  // encabezado. Un tramo sin ninguna pregunta reconocible no tiene forma de
  // convertirse en filas editables, así que se guarda entero —encabezado
  // incluido— como contenido adicional en vez de perderse.
  let category = "";
  let chunkHeadingLine: string | null = null;
  let chunkLeadingLines: string[] = [];
  let chunkHasItem = false;
  let current: { question: string; answer: string } | null = null;

  const flushItem = () => {
    if (current) {
      items.push({ id: makeId(), question: current.question, answer: current.answer.trim(), category });
      chunkHasItem = true;
    }
    current = null;
  };
  const flushChunk = () => {
    flushItem();
    // Con preguntas, cualquier texto suelto antes de la primera no tiene dónde
    // ir en una fila de pregunta/respuesta: se guarda aparte para no perderlo.
    // Sin ninguna pregunta, el tramo entero (con su encabezado) va ahí.
    const keepLeading = chunkLeadingLines.some((l) => l.trim());
    if (!chunkHasItem || keepLeading) {
      const text = [chunkHeadingLine, ...chunkLeadingLines]
        .filter((l): l is string => l !== null)
        .join("\n")
        .trim();
      if (text) extraBlocks.push(text);
    }
    chunkHeadingLine = null;
    chunkLeadingLines = [];
    chunkHasItem = false;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const heading = HEADING_RE.exec(line);
    const question = QUESTION_RE.exec(line.trim());
    if (heading) {
      flushChunk();
      category = heading[1].trim();
      chunkHeadingLine = `## ${category}`;
      continue;
    }
    if (question) {
      flushItem();
      current = { question: question[1].trim(), answer: "" };
      continue;
    }
    if (current) current.answer += (current.answer ? "\n" : "") + line;
    else chunkLeadingLines.push(line);
  }
  flushChunk();

  return { preamble, items, extras: extraBlocks.join("\n\n").trim() };
}

export function newQaItem(category = ""): QaItem {
  return { id: makeId(), question: "", answer: "", category };
}

/** Categorías en uso, en el orden en que aparece la primera pregunta de cada una. */
export function categoriesOf(items: QaItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const c = item.category.trim();
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// Agrupa por categoría (en el orden en que cada una aparece por primera vez) en
// vez de por posición en la lista: así una pregunta que se movió de categoría
// queda junto a las demás de la suya, y no se repite el mismo encabezado dos
// veces si el orden de la lista las dejó separadas.
export function serializeKnowledgeContent(parsed: { preamble: string; items: QaItem[]; extras: string }): string {
  const usable = parsed.items.filter((item) => item.question.trim() || item.answer.trim());
  const groups = new Map<string, QaItem[]>();
  for (const item of usable) {
    const category = item.category.trim();
    const group = groups.get(category);
    if (group) group.push(item);
    else groups.set(category, [item]);
  }

  const blocks: string[] = [];
  if (parsed.preamble.trim()) blocks.push(parsed.preamble.trim());

  // Sin categoría primero (como la introducción de un FAQ, sin encabezado
  // propio), luego cada categoría con el suyo.
  const order = ["", ...[...groups.keys()].filter((c) => c !== "")];
  for (const category of order) {
    const items = groups.get(category);
    if (!items?.length) continue;
    const lines = category ? [`## ${category}`] : [];
    for (const item of items) lines.push(`**${item.question.trim() || "(sin pregunta)"}**\n${item.answer.trim() || "—"}`);
    blocks.push(lines.join("\n\n"));
  }

  if (parsed.extras.trim()) blocks.push(parsed.extras.trim());

  return blocks.join("\n\n") + (blocks.length ? "\n" : "");
}

export function matchesFilter(item: QaItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.question.toLowerCase().includes(q) ||
    item.answer.toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q)
  );
}
