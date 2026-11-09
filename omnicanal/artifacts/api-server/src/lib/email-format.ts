import crypto from "node:crypto";

// Las piezas puras del correo: leer lo que devuelve la API de Gmail, armar el MIME
// de una respuesta y limpiar el texto para la IA. Sin base de datos ni red, para
// poder probarlas sin nada alrededor.

export type EmailAddress = { address: string; name: string | null };

// Lo que usamos de un mensaje de la API de Gmail (format=full).
export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailApiMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type ParsedAttachment = { partId: string; filename: string; mimeType: string; size: number };

export type ParsedEmail = {
  gmailMessageId: string;
  gmailThreadId: string;
  labelIds: string[];
  rfcMessageId: string | null;
  references: string | null;
  from: EmailAddress | null;
  replyTo: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string | null;
  date: Date | null;
  text: string;
  html: string | null;
  attachments: ParsedAttachment[];
  /** Boletines, avisos automáticos y rebotes: no son un cliente escribiendo. */
  isAutomated: boolean;
};

// Un HTML de boletín puede pesar megas; lo que pase de aquí no se guarda y el
// panel se queda con la versión en texto.
const MAX_HTML_CHARS = 500_000;

// ── Cabeceras ─────────────────────────────────────────────────────────────────

function decodeBytes(bytes: Buffer, charset: string | null): string {
  const cs = (charset ?? "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g;

/** Decodifica las palabras codificadas de RFC 2047 (`=?UTF-8?B?…?=`). */
export function decodeMimeWords(value: string): string {
  if (!value.includes("=?")) return value;
  return (
    value
      // El espacio entre dos palabras codificadas seguidas no forma parte del texto.
      .replace(/(\?=)\s+(?==\?)/g, "$1")
      .replace(ENCODED_WORD, (match, charset: string, encoding: string, text: string) => {
        try {
          const bytes =
            encoding.toUpperCase() === "B"
              ? Buffer.from(text, "base64")
              : Buffer.from(
                  text
                    .replace(/_/g, " ")
                    .replace(/=([0-9A-Fa-f]{2})/g, (_x, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                  "latin1",
                );
          return decodeBytes(bytes, charset);
        } catch {
          return match;
        }
      })
  );
}

/** Lee una lista de direcciones (`"Ana" <ana@x.com>, beto@y.com`). */
export function parseAddressList(value: string | null | undefined): EmailAddress[] {
  if (!value) return [];
  const decoded = decodeMimeWords(value);

  // Se parte por comas que no estén dentro de comillas ni de <>.
  const pieces: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of decoded) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") inAngle = true;
    else if (!inQuotes && ch === ">") inAngle = false;
    if ((ch === "," || ch === ";") && !inQuotes && !inAngle) {
      pieces.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  pieces.push(current);

  const out: EmailAddress[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    const angle = piece.match(/^(.*)<([^>]+)>\s*$/);
    let address: string;
    let name: string | null = null;
    if (angle) {
      address = angle[2].trim();
      name =
        angle[1]
          .trim()
          .replace(/^"(.*)"$/, "$1")
          .replace(/\\(["\\])/g, "$1")
          .trim() || null;
    } else {
      // Formato antiguo: `ana@x.com (Ana)`.
      const comment = piece.match(/\(([^)]*)\)/);
      address = piece.replace(/\([^)]*\)/, "").trim();
      name = comment?.[1]?.trim() || null;
    }
    if (!isEmailAddress(address)) continue;
    out.push({ address: address.toLowerCase(), name: name && name.toLowerCase() !== address.toLowerCase() ? name : null });
  }
  return out;
}

export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(value);
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return isEmailAddress(trimmed) ? trimmed : null;
}

function headerGetter(headers: GmailHeader[] | undefined) {
  return (name: string): string | null => {
    const found = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : null;
  };
}

// ── Cuerpo ────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  iexcl: "¡",
  iquest: "¿",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) return safeFromCodePoint(parseInt(entity.slice(2), 16)) ?? match;
    if (entity.startsWith("#")) return safeFromCodePoint(parseInt(entity.slice(1), 10)) ?? match;
    return NAMED_ENTITIES[entity] ?? match;
  });
}

function safeFromCodePoint(code: number): string | null {
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/** Versión en texto de un HTML de correo, para cuando el mensaje no trae parte text/plain. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(stripped)
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function partCharset(part: GmailPart): string | null {
  const contentType = headerGetter(part.headers)("Content-Type") ?? "";
  return contentType.match(/charset="?([^";\s]+)"?/i)?.[1] ?? null;
}

function decodePartBody(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return "";
  return decodeBytes(Buffer.from(data, "base64url"), partCharset(part));
}

function collectParts(
  part: GmailPart,
  acc: { text: string | null; html: string | null; attachments: ParsedAttachment[] },
): void {
  const mime = (part.mimeType ?? "").toLowerCase();
  const disposition = (headerGetter(part.headers)("Content-Disposition") ?? "").toLowerCase();
  const filename = decodeMimeWords(part.filename ?? "").trim();

  if (part.parts?.length) {
    for (const child of part.parts) collectParts(child, acc);
    return;
  }

  if (filename && (part.body?.attachmentId || part.body?.data)) {
    acc.attachments.push({
      partId: part.partId ?? "",
      filename,
      mimeType: mime || "application/octet-stream",
      size: part.body?.size ?? 0,
    });
    return;
  }

  if (disposition.startsWith("attachment")) return;
  if (mime === "text/plain" && acc.text === null) acc.text = decodePartBody(part);
  else if (mime === "text/html" && acc.html === null) acc.html = decodePartBody(part);
}

// ── Automáticos ───────────────────────────────────────────────────────────────

const AUTOMATED_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|notificaciones|newsletter)([+._-]|$)/i;

/**
 * ¿Lo mandó una máquina? Boletines, respuestas automáticas y rebotes no abren un
 * hilo de atención: nadie espera respuesta y contestarles solo genera ruido (o un
 * bucle con otra respuesta automática).
 */
export function isAutomatedEmail(get: (name: string) => string | null, fromAddress: string | null): boolean {
  const autoSubmitted = get("Auto-Submitted");
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== "no") return true;
  const precedence = get("Precedence")?.trim().toLowerCase();
  if (precedence && ["bulk", "junk", "list", "auto_reply"].includes(precedence)) return true;
  if (get("List-Id") || get("List-Unsubscribe")) return true;
  if (get("X-Autoreply") || get("X-Autorespond")) return true;
  const local = fromAddress?.split("@")[0] ?? "";
  return AUTOMATED_LOCAL_PART.test(local);
}

// ── Mensaje completo ──────────────────────────────────────────────────────────

export function parseGmailMessage(message: GmailApiMessage): ParsedEmail {
  const payload = message.payload ?? {};
  const get = headerGetter(payload.headers);
  const acc: { text: string | null; html: string | null; attachments: ParsedAttachment[] } = {
    text: null,
    html: null,
    attachments: [],
  };
  collectParts(payload, acc);

  const from = parseAddressList(get("From"))[0] ?? null;
  const dateHeader = get("Date");
  const parsedDate = dateHeader ? new Date(dateHeader) : null;
  const internal = message.internalDate ? new Date(Number(message.internalDate)) : null;
  const date =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate
      : internal && !Number.isNaN(internal.getTime())
        ? internal
        : null;

  const html = acc.html && acc.html.length <= MAX_HTML_CHARS ? acc.html : null;
  const text = (acc.text ?? "").trim() || (acc.html ? htmlToText(acc.html) : "");

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    labelIds: message.labelIds ?? [],
    rfcMessageId: get("Message-ID")?.trim() || null,
    references: get("References")?.replace(/\s+/g, " ").trim() || null,
    from,
    replyTo: parseAddressList(get("Reply-To"))[0] ?? null,
    to: parseAddressList(get("To")),
    cc: parseAddressList(get("Cc")),
    subject: decodeMimeWords(get("Subject") ?? "").trim() || null,
    date,
    text: text.replace(/\r\n/g, "\n"),
    html,
    attachments: acc.attachments,
    isAutomated: isAutomatedEmail(get, from?.address ?? null),
  };
}

// ── Texto para la IA ──────────────────────────────────────────────────────────

// Dónde empieza lo citado en una respuesta. Cada cliente de correo lo escribe a su
// manera; estos cubren Gmail, Outlook y Apple Mail en español e inglés.
const QUOTE_MARKERS = [
  /^On\b[^\n]*(\n[^\n]*)?\bwrote:[ \t]*$/m,
  /^El\b[^\n]*(\n[^\n]*)?\bescribió:[ \t]*$/m,
  /^-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado)\s*-{2,}/im,
  /^(De|From):[^\n]+\n(Enviado|Sent|Fecha|Date):/im,
  /^_{10,}[ \t]*$/m,
];

/**
 * Se queda con lo que el cliente escribió en este correo, sin la conversación
 * citada debajo. Sin esto la IA contestaría otra vez a mensajes viejos, y un
 * teléfono de nuestra propia firma citada parecería el del cliente.
 */
export function stripQuotedReply(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  let cut = normalized.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(normalized);
    if (match && match.index < cut) cut = match.index;
  }
  const own = normalized
    .slice(0, cut)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return own || normalized.trim();
}

/** Una línea corta para la bandeja. */
export function previewOf(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Adapta al correo lo que devolvió el agente. Su prompt está pensado para chat:
 * las marcas de botones, fotos y citas no significan nada en un email, y la
 * palabra de escalado no es texto para el cliente sino una señal para nosotros.
 * La de pedido confirmado tampoco: por correo no hay aviso de pedido, así que se
 * trata como un traspaso más y lo sigue una persona.
 */
export function sanitizeAiEmailReply(raw: string): { text: string; escalate: boolean } {
  const escalate = /ESCALAR_A_HUMANO|PEDIDO_CONFIRMADO/i.test(raw);
  const text = raw
    .replace(/\[\[OPCIONES:\s*([^\]]+?)\s*\]\]/gi, (_m, options: string) => {
      const items = options
        .split("|")
        .map((o) => o.trim())
        .filter(Boolean);
      return items.length ? `\n${items.map((o) => `• ${o}`).join("\n")}` : "";
    })
    .replace(/\[\[(FOTO|CITA|IMAGEN):[^\]]*\]\]/gi, "")
    .replace(/ESCALAR_A_HUMANO|PEDIDO_CONFIRMADO/gi, "")
    .replace(/^\[\d{1,2}\/\d{1,2}[^\]\n]*\][ \t]*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, escalate };
}

// ── Teléfonos ─────────────────────────────────────────────────────────────────

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Un número de WhatsApp listo para escribirlo en un correo: legible y con su
 * enlace wa.me. El número de Meta se guarda a veces sin código de país
 * ("4846649430"); con 10 dígitos se toma como de Norteamérica (+1), que es
 * donde están República Dominicana y Estados Unidos.
 */
export function whatsappContact(value: string | null | undefined): { display: string; link: string } | null {
  let digits = phoneDigits(value);
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 8) return null;
  const display =
    digits.length === 11 && digits.startsWith("1")
      ? `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
      : `+${digits}`;
  return { display, link: `https://wa.me/${digits}` };
}

/**
 * ¿Es el mismo número? Tolera formato y prefijo de país: "809-555-1234" y el
 * wa_id "18095551234" son el mismo teléfono. Por debajo de 8 dígitos no se
 * compara por sufijo, porque ahí las coincidencias casuales ya son probables.
 */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length < 7 || db.length < 7) return false;
  if (da === db) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return short.length >= 8 && long.endsWith(short);
}

/** Números de teléfono que aparecen en un texto (una firma, por ejemplo). */
export function extractPhoneCandidates(text: string): string[] {
  const found = new Map<string, string>();
  for (const match of text.match(/\+?\d[\d\s().-]{5,18}\d/g) ?? []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) continue; // una fecha
    const digits = phoneDigits(match);
    if (digits.length < 7 || digits.length > 15) continue;
    if (!found.has(digits)) found.set(digits, match.trim());
  }
  return [...found.values()];
}

// ── Salida ────────────────────────────────────────────────────────────────────

// Una cabecera no puede llevar saltos de línea: sería una puerta para inyectar
// cabeceras propias (un Bcc, por ejemplo) desde un campo de texto.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Codifica una cabecera con RFC 2047 cuando lleva caracteres fuera de ASCII. */
export function encodeHeader(value: string): string {
  const clean = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  // Cada palabra codificada tiene un tope de 75 caracteres: se trocea sin partir
  // un carácter multibyte por la mitad.
  const chunks: string[] = [];
  let current = "";
  for (const ch of clean) {
    if (Buffer.byteLength(current + ch, "utf8") > 45) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ");
}

export function formatAddress(addr: EmailAddress): string {
  const address = oneLine(addr.address);
  const name = addr.name ? oneLine(addr.name) : "";
  if (!name) return address;
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${address}>`;
  return `${encodeHeader(name)} <${address}>`;
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re:";
  return /^(re|rv|aw|sv)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** La cadena References de una respuesta: la del mensaje anterior más su propio Message-ID. */
export function buildReferences(previous: { references: string | null; rfcMessageId: string | null } | null): string | null {
  if (!previous?.rfcMessageId) return previous?.references ?? null;
  const ids = [...(previous.references ?? "").split(/\s+/), previous.rfcMessageId].filter(Boolean);
  // Los clientes de correo recortan las cadenas muy largas por el principio.
  return [...new Set(ids)].slice(-20).join(" ");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<div dir="ltr">${linked.replace(/\r?\n/g, "<br>")}</div>`;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export type OutgoingAttachment = { filename: string; mimeType: string; data: Buffer };

export type OutgoingEmail = {
  from: EmailAddress;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: OutgoingAttachment[];
  /** Fijo solo en las pruebas. */
  boundary?: string;
  /** Fijo solo en las pruebas; boundary de la envoltura multipart/mixed cuando hay adjuntos. */
  mixedBoundary?: string;
};

// El nombre de un adjunto en Content-Disposition, con RFC 2231 cuando lleva
// caracteres fuera de ASCII — a diferencia de una cabecera normal, aquí no basta
// codificar la palabra: hace falta el parámetro `filename*` para que Gmail y
// Outlook lo muestren decodificado en vez de literal.
function contentDispositionFilename(name: string): string {
  const clean = oneLine(name);
  if (/^[\x20-\x7e]*$/.test(clean)) return `filename="${clean.replace(/(["\\])/g, "\\$1")}"`;
  return `filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * El mensaje RFC 2822 de un correo saliente, con versión en texto y en HTML.
 * Sin adjuntos es un solo `multipart/alternative`; con ellos, ese cuerpo va
 * envuelto en un `multipart/mixed` junto a cada archivo en base64.
 */
export function buildMimeMessage(email: OutgoingEmail): string {
  const boundary = email.boundary ?? `omni_${crypto.randomBytes(12).toString("hex")}`;
  const attachments = email.attachments ?? [];
  const headers = [
    `From: ${formatAddress(email.from)}`,
    `To: ${email.to.map(oneLine).join(", ")}`,
    ...(email.cc?.length ? [`Cc: ${email.cc.map(oneLine).join(", ")}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    ...(email.inReplyTo ? [`In-Reply-To: ${oneLine(email.inReplyTo)}`] : []),
    ...(email.references ? [`References: ${oneLine(email.references)}`] : []),
    "MIME-Version: 1.0",
  ];
  const part = (type: string, body: string) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body, "utf8").toString("base64")),
  ];
  const altBody = [...part("text/plain", email.text), ...part("text/html", textToHtml(email.text)), `--${boundary}--`];

  if (attachments.length === 0) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", ...altBody, ""].join(
      "\r\n",
    );
  }

  const mixedBoundary = email.mixedBoundary ?? `omni_mix_${crypto.randomBytes(12).toString("hex")}`;
  const attachmentParts = attachments.flatMap((a) => [
    `--${mixedBoundary}`,
    `Content-Type: ${a.mimeType}; name="${oneLine(a.filename).replace(/(["\\])/g, "\\$1")}"`,
    `Content-Disposition: attachment; ${contentDispositionFilename(a.filename)}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(a.data.toString("base64")),
  ]);
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...altBody,
    ...attachmentParts,
    `--${mixedBoundary}--`,
    "",
  ].join("\r\n");
}
