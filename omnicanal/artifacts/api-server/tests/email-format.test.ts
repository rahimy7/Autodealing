import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod";
process.env.NODE_ENV = "test";

const {
  decodeMimeWords,
  parseAddressList,
  parseGmailMessage,
  htmlToText,
  stripQuotedReply,
  sanitizeAiEmailReply,
  phonesMatch,
  extractPhoneCandidates,
  whatsappContact,
  encodeHeader,
  formatAddress,
  replySubject,
  buildReferences,
  buildMimeMessage,
  isAutomatedEmail,
} = await import("../src/lib/email-format.js");
const { signPayload, verifyPayload, signToken, verifyToken } = await import("../src/lib/auth.js");

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("lib/email-format — cabeceras", () => {
  it("decodifica palabras codificadas en base64 y quoted-printable", () => {
    assert.equal(decodeMimeWords("=?UTF-8?B?Q290aXphY2nDs24=?="), "Cotización");
    assert.equal(decodeMimeWords("=?ISO-8859-1?Q?Informaci=F3n_urgente?="), "Información urgente");
    assert.equal(decodeMimeWords("Hola mundo"), "Hola mundo");
  });

  it("une dos palabras codificadas seguidas sin el espacio intermedio", () => {
    assert.equal(decodeMimeWords("=?UTF-8?B?Q290aXph?= =?UTF-8?B?Y2nDs24=?="), "Cotización");
  });

  it("lee listas de direcciones con nombres, comillas y comas", () => {
    const list = parseAddressList('"Pérez, Ana" <Ana@Example.com>, beto@correo.do, Carla <carla@x.com>');
    assert.deepEqual(list, [
      { address: "ana@example.com", name: "Pérez, Ana" },
      { address: "beto@correo.do", name: null },
      { address: "carla@x.com", name: "Carla" },
    ]);
  });

  it("descarta lo que no es una dirección", () => {
    assert.deepEqual(parseAddressList("undisclosed-recipients:;"), []);
  });
});

describe("lib/email-format — parseGmailMessage", () => {
  const message = {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    internalDate: "1767225600000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Juan Pérez <JUAN@cliente.com>" },
        { name: "To", value: "ventas@negocio.com" },
        { name: "Subject", value: "=?UTF-8?B?Q290aXphY2nDs24=?=" },
        { name: "Message-ID", value: "<abc@mail.gmail.com>" },
        { name: "Date", value: "Tue, 1 Sep 2026 10:00:00 -0400" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
              body: { data: b64u("Hola, quiero una cotización.\n") },
            },
            { partId: "0.1", mimeType: "text/html", body: { data: b64u("<p>Hola, quiero una cotización.</p>") } },
          ],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "plano.pdf",
          body: { size: 2048, attachmentId: "att-1" },
        },
      ],
    },
  };

  it("extrae remitente, asunto, cuerpo y adjuntos", () => {
    const parsed = parseGmailMessage(message);
    assert.equal(parsed.from?.address, "juan@cliente.com");
    assert.equal(parsed.from?.name, "Juan Pérez");
    assert.equal(parsed.subject, "Cotización");
    assert.equal(parsed.text, "Hola, quiero una cotización.");
    assert.equal(parsed.rfcMessageId, "<abc@mail.gmail.com>");
    assert.equal(parsed.date?.toISOString(), "2026-09-01T14:00:00.000Z");
    assert.deepEqual(parsed.attachments, [
      { partId: "1", filename: "plano.pdf", mimeType: "application/pdf", size: 2048 },
    ]);
    assert.equal(parsed.isAutomated, false);
  });

  it("usa el HTML convertido a texto cuando no hay parte text/plain", () => {
    const parsed = parseGmailMessage({
      id: "m2",
      threadId: "t2",
      payload: { mimeType: "text/html", headers: [], body: { data: b64u("<div>Línea 1<br>Línea&nbsp;2</div>") } },
    });
    assert.equal(parsed.text, "Línea 1\nLínea 2");
  });

  it("respeta el charset declarado de la parte", () => {
    const latin1 = Buffer.from("Información", "latin1").toString("base64url");
    const parsed = parseGmailMessage({
      id: "m3",
      threadId: "t3",
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "Content-Type", value: "text/plain; charset=ISO-8859-1" }],
        body: { data: latin1 },
      },
    });
    assert.equal(parsed.text, "Información");
  });
});

describe("lib/email-format — automáticos", () => {
  const headers = (h: Record<string, string>) => (name: string) =>
    Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? null;

  it("reconoce boletines, respuestas automáticas y remitentes no-reply", () => {
    assert.equal(isAutomatedEmail(headers({ "List-Unsubscribe": "<mailto:x>" }), "news@shop.com"), true);
    assert.equal(isAutomatedEmail(headers({ "Auto-Submitted": "auto-replied" }), "ana@x.com"), true);
    assert.equal(isAutomatedEmail(headers({}), "no-reply@banco.com"), true);
    assert.equal(isAutomatedEmail(headers({}), "mailer-daemon@googlemail.com"), true);
  });

  it("deja pasar a una persona", () => {
    assert.equal(isAutomatedEmail(headers({ "Auto-Submitted": "no" }), "ana@x.com"), false);
    assert.equal(isAutomatedEmail(headers({}), "noelia@x.com"), false);
  });
});

describe("lib/email-format — texto para la IA", () => {
  it("corta la conversación citada de Gmail en español", () => {
    const text = "Perfecto, lo quiero en azul.\n\nEl mar, 1 sept 2026 a las 10:00, Ventas <ventas@negocio.com>\nescribió:\n> ¿De qué color lo desea?\n> Tel. 809-555-0000";
    assert.equal(stripQuotedReply(text), "Perfecto, lo quiero en azul.");
  });

  it("corta la cita en inglés y las líneas con >", () => {
    assert.equal(stripQuotedReply("Thanks!\n\nOn Tue, Sep 1, 2026 at 10:00 AM Shop <a@b.com> wrote:\n> hi"), "Thanks!");
    assert.equal(stripQuotedReply("Sí\n> antes"), "Sí");
  });

  it("devuelve el texto entero si todo era cita", () => {
    assert.equal(stripQuotedReply("> solo cita"), "> solo cita");
  });

  it("convierte las marcas del chat en texto de correo y detecta el escalado", () => {
    const out = sanitizeAiEmailReply("¿Para interior o exterior? [[OPCIONES: Interior | Exterior]] [[FOTO:pintura-x]]");
    assert.equal(out.escalate, false);
    assert.equal(out.text, "¿Para interior o exterior?\n• Interior\n• Exterior");
    assert.deepEqual(sanitizeAiEmailReply("ESCALAR_A_HUMANO"), { text: "", escalate: true });
    // Por correo no hay aviso de pedido: se escala igual y la palabra no sale.
    assert.deepEqual(sanitizeAiEmailReply("PEDIDO_CONFIRMADO"), { text: "", escalate: true });
  });

  it("convierte HTML con entidades y listas", () => {
    assert.equal(htmlToText("<style>p{}</style><ul><li>Uno</li><li>Dos &amp; tres</li></ul>"), "• Uno\n• Dos & tres");
  });
});

describe("lib/email-format — teléfonos", () => {
  it("escribe el WhatsApp del negocio legible y con su enlace, con o sin código de país", () => {
    const expected = { display: "+1 (484) 664-9430", link: "https://wa.me/14846649430" };
    assert.deepEqual(whatsappContact("4846649430"), expected);
    assert.deepEqual(whatsappContact("+1 484-664-9430"), expected);
    assert.deepEqual(whatsappContact("34612345678"), { display: "+34612345678", link: "https://wa.me/34612345678" });
    assert.equal(whatsappContact(null), null);
    assert.equal(whatsappContact("12345"), null);
  });

  it("empareja el mismo número con y sin prefijo de país", () => {
    assert.equal(phonesMatch("809-555-1234", "18095551234"), true);
    assert.equal(phonesMatch("+1 (809) 555-1234", "8095551234"), true);
  });

  it("no empareja números distintos ni demasiado cortos", () => {
    assert.equal(phonesMatch("8095551234", "8095559999"), false);
    assert.equal(phonesMatch("5551234", "18095551234"), false);
    assert.equal(phonesMatch(null, "8095551234"), false);
  });

  it("encuentra teléfonos en una firma y no confunde una fecha", () => {
    const found = extractPhoneCandidates("Juan Pérez\nTel: +1 809-555-1234\nFecha 2026-09-01");
    assert.deepEqual(found, ["+1 809-555-1234"]);
  });
});

describe("lib/email-format — salida", () => {
  it("codifica cabeceras con acentos y deja las ASCII tal cual", () => {
    assert.equal(encodeHeader("Re: Hello"), "Re: Hello");
    assert.equal(decodeMimeWords(encodeHeader("Re: Cotización de pintura")), "Re: Cotización de pintura");
  });

  it("parte un asunto largo en palabras codificadas que se vuelven a unir", () => {
    const subject = "Cotización ".repeat(12).trim();
    const encoded = encodeHeader(subject);
    assert.ok(encoded.split("\r\n ").every((word) => word.length <= 75));
    assert.equal(decodeMimeWords(encoded.replace(/\r\n /g, " ")), subject);
  });

  it("no deja inyectar cabeceras con saltos de línea", () => {
    assert.equal(encodeHeader("Hola\r\nBcc: espia@x.com"), "Hola Bcc: espia@x.com");
    assert.equal(formatAddress({ address: "a@b.com", name: 'Tienda "Centro"' }), '"Tienda \\"Centro\\"" <a@b.com>');
  });

  it("prefija Re: una sola vez", () => {
    assert.equal(replySubject("Cotización"), "Re: Cotización");
    assert.equal(replySubject("RE: Cotización"), "RE: Cotización");
    assert.equal(replySubject(null), "Re:");
  });

  it("encadena References con el Message-ID anterior", () => {
    assert.equal(buildReferences({ references: "<a@x> <b@x>", rfcMessageId: "<c@x>" }), "<a@x> <b@x> <c@x>");
    assert.equal(buildReferences({ references: null, rfcMessageId: "<c@x>" }), "<c@x>");
    assert.equal(buildReferences(null), null);
  });

  it("arma un MIME con texto y HTML que se lee de vuelta", () => {
    const mime = buildMimeMessage({
      from: { address: "ventas@negocio.com", name: "Decolor Ventas" },
      to: ["juan@cliente.com"],
      subject: "Re: Cotización",
      text: "Hola Juan,\nAquí va: https://negocio.com/p/1",
      inReplyTo: "<abc@mail.gmail.com>",
      references: "<abc@mail.gmail.com>",
      boundary: "BOUNDARY",
    });
    assert.match(mime, /^From: "Decolor Ventas" <ventas@negocio\.com>\r\n/);
    assert.match(mime, /\r\nIn-Reply-To: <abc@mail\.gmail\.com>\r\n/);
    assert.match(mime, /Content-Type: multipart\/alternative; boundary="BOUNDARY"/);
    const bodies = [...mime.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--BOUNDARY/g)].map((m) =>
      Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"),
    );
    assert.equal(bodies[0], "Hola Juan,\nAquí va: https://negocio.com/p/1");
    assert.match(bodies[1], /<a href="https:\/\/negocio\.com\/p\/1">/);
    assert.match(bodies[1], /Hola Juan,<br>/);
  });

  it("arma un MIME con adjuntos: multipart/mixed envolviendo al alternative", () => {
    const pdfBytes = Buffer.from("%PDF-1.4 contenido de prueba");
    const mime = buildMimeMessage({
      from: { address: "ventas@negocio.com", name: "Decolor Ventas" },
      to: ["juan@cliente.com"],
      subject: "Cotización",
      text: "Va adjunta la cotización.",
      boundary: "ALT",
      mixedBoundary: "MIXED",
      attachments: [
        { filename: "cotización.pdf", mimeType: "application/pdf", data: pdfBytes },
        { filename: "logo.png", mimeType: "image/png", data: Buffer.from([1, 2, 3, 4]) },
      ],
    });

    assert.match(mime, /^Content-Type: multipart\/mixed; boundary="MIXED"\r\n\r\n--MIXED\r\n/m);
    assert.match(mime, /--MIXED\r\nContent-Type: multipart\/alternative; boundary="ALT"/);
    // El cuerpo de texto/HTML sigue intacto dentro del alternative.
    const altBody = Buffer.from(
      mime.match(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--ALT\r\n/)![1].replace(/\r\n/g, ""),
      "base64",
    ).toString("utf8");
    assert.equal(altBody, "Va adjunta la cotización.");

    // Primer adjunto: nombre con acento → filename* codificado por RFC 2231.
    assert.match(
      mime,
      /--MIXED\r\nContent-Type: application\/pdf; name="cotizaci[^"]*\.pdf"\r\nContent-Disposition: attachment; filename\*=UTF-8''cotizaci%C3%B3n\.pdf\r\n/,
    );
    // Segundo adjunto: nombre ASCII → filename= entre comillas, sin RFC 2231.
    assert.match(mime, /Content-Disposition: attachment; filename="logo\.png"\r\n/);

    // Los bytes del PDF se recuperan intactos.
    const pdfPart = mime.match(/name="cotizaci[^"]*\.pdf"\r\nContent-Disposition:[^\r]+\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--MIXED/)![1];
    assert.deepEqual(Buffer.from(pdfPart.replace(/\r\n/g, ""), "base64"), pdfBytes);

    assert.match(mime, /\r\n--MIXED--\r\n$/);
  });

  it("sin adjuntos sigue siendo un solo multipart/alternative (compatibilidad)", () => {
    const mime = buildMimeMessage({
      from: { address: "a@b.com", name: null },
      to: ["c@d.com"],
      subject: "Hola",
      text: "Texto",
      boundary: "ALT",
    });
    assert.doesNotMatch(mime, /multipart\/mixed/);
    assert.match(mime, /^Content-Type: multipart\/alternative; boundary="ALT"/m);
  });
});

describe("lib/auth — payloads firmados", () => {
  it("verifica un payload con su propósito", () => {
    const token = signPayload("gmail-oauth", { returnUrl: "https://x.com/settings" }, 60);
    assert.equal(verifyPayload("gmail-oauth", token)?.returnUrl, "https://x.com/settings");
  });

  it("rechaza otro propósito, una firma alterada y un payload caducado", () => {
    const token = signPayload("gmail-oauth", { a: 1 }, 60);
    assert.equal(verifyPayload("otro", token), null);
    assert.equal(verifyPayload("gmail-oauth", `${token}x`), null);
    assert.equal(verifyPayload("gmail-oauth", signPayload("gmail-oauth", { a: 1 }, -10)), null);
  });

  it("un token de sesión no sirve como state ni al revés", () => {
    const session = signToken({ role: "admin", name: "A", email: "a@x.com", agentId: null });
    assert.equal(verifyPayload("gmail-oauth", session), null);
    assert.equal(verifyToken(signPayload("gmail-oauth", { role: "admin" }, 60)), null);
  });
});
