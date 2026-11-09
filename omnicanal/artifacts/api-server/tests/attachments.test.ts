import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInboundEvents } from "../src/lib/meta.js";
import {
  cleanFileName,
  fileExtension,
  fileNameFromUrl,
  historyContent,
  mediaPreview,
  mediaSummary,
  outboundKind,
} from "../src/lib/media.js";

const MB = 1024 * 1024;

function waMessage(msg: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN_1" }, messages: [{ from: "18095551234", ...msg }] } }] }],
  };
}

describe("adjuntos — parseInboundEvents (WhatsApp)", () => {
  it("una foto con pie", () => {
    const [ev] = parseInboundEvents(
      waMessage({ id: "wamid.IMG", type: "image", image: { id: "m-1", mime_type: "image/jpeg", caption: "este color" } }),
    );
    assert.equal(ev.text, null);
    assert.equal(ev.audio, null);
    assert.deepEqual(ev.media, {
      kind: "image",
      mediaId: "m-1",
      url: null,
      mimeType: "image/jpeg",
      filename: null,
      caption: "este color",
    });
  });

  it("un documento conserva su nombre", () => {
    const [ev] = parseInboundEvents(
      waMessage({
        id: "wamid.DOC",
        type: "document",
        document: { id: "m-2", mime_type: "application/pdf", filename: "cotizacion.pdf" },
      }),
    );
    assert.equal(ev.media?.kind, "document");
    assert.equal(ev.media?.filename, "cotizacion.pdf");
  });

  it("un sticker se guarda como imagen", () => {
    const [ev] = parseInboundEvents(waMessage({ id: "wamid.STK", type: "sticker", sticker: { id: "m-3", mime_type: "image/webp" } }));
    assert.equal(ev.media?.kind, "image");
  });

  it("un adjunto sin id de media se descarta", () => {
    assert.equal(parseInboundEvents(waMessage({ id: "wamid.X", type: "video", video: {} })).length, 0);
  });
});

describe("adjuntos — parseInboundEvents (Messenger / Instagram)", () => {
  const messenger = (message: Record<string, unknown>) => ({
    object: "page",
    entry: [{ messaging: [{ sender: { id: "PSID_1" }, message: { mid: "m_1", ...message } }] }],
  });

  it("varias fotos en un mensaje son varios eventos, cada uno con su id", () => {
    const events = parseInboundEvents(
      messenger({
        attachments: [
          { type: "image", payload: { url: "https://cdn.example.com/a.jpg" } },
          { type: "image", payload: { url: "https://cdn.example.com/b.jpg" } },
        ],
      }),
    );
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => e.externalMessageId),
      ["m_1", "m_1#1"],
    );
    assert.deepEqual(
      events.map((e) => e.media?.url),
      ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    );
  });

  it("un archivo es un documento", () => {
    const [ev] = parseInboundEvents(
      messenger({ attachments: [{ type: "file", payload: { url: "https://cdn.example.com/x/Factura.pdf?t=1" } }] }),
    );
    assert.equal(ev.media?.kind, "document");
  });

  it("los adjuntos que no son archivos (share, story_mention) no generan eventos", () => {
    const events = parseInboundEvents(messenger({ attachments: [{ type: "share", payload: { url: "https://x.com" } }] }));
    assert.equal(events.length, 0);
  });
});

describe("adjuntos — qué tipo de mensaje sale", () => {
  it("WhatsApp solo muestra JPEG y PNG como foto", () => {
    assert.equal(outboundKind("image/jpeg", 1 * MB, "whatsapp"), "image");
    assert.equal(outboundKind("image/webp", 1 * MB, "whatsapp"), "document");
    assert.equal(outboundKind("image/webp", 1 * MB, "instagram"), "image");
  });

  it("una foto de más de 5 MB sale como documento", () => {
    assert.equal(outboundKind("image/jpeg", 6 * MB, "whatsapp"), "document");
  });

  it("video y audio por su tipo; lo demás, documento", () => {
    assert.equal(outboundKind("video/mp4", 10 * MB, "whatsapp"), "video");
    assert.equal(outboundKind("video/quicktime", 10 * MB, "whatsapp"), "document");
    assert.equal(outboundKind("audio/mpeg", 1 * MB, "whatsapp"), "audio");
    assert.equal(outboundKind("application/pdf", 1 * MB, "whatsapp"), "document");
  });
});

describe("adjuntos — nombres y textos", () => {
  it("cleanFileName quita rutas y caracteres de control", () => {
    assert.equal(cleanFileName("../../etc/pas\u0000swd.txt"), "passwd.txt");
    assert.equal(cleanFileName("C:\\Users\\ana\\Cotización final.pdf"), "Cotización final.pdf");
    assert.equal(cleanFileName("   "), null);
  });

  it("fileExtension prefiere la del nombre", () => {
    assert.equal(fileExtension("application/octet-stream", "plano.DWG"), "dwg");
    assert.equal(fileExtension("image/png", null), "png");
    assert.equal(fileExtension("application/x-desconocido", null), "bin");
  });

  it("fileNameFromUrl saca el nombre de la URL de la CDN", () => {
    assert.equal(fileNameFromUrl("https://cdn.fbsbx.com/v/t59/Cotizacion%20mayo.pdf?_nc_cat=1"), "Cotizacion mayo.pdf");
    assert.equal(fileNameFromUrl("https://cdn.example.com/v/abc"), null);
  });

  it("un adjunto sin pie se lee por su descripción, con pie se nombra el adjunto", () => {
    const summary = mediaSummary("image", null);
    assert.equal(mediaPreview("image", null, summary), "📷 Imagen");
    assert.equal(mediaPreview("image", null, "este color"), "📷 este color");
    assert.equal(historyContent({ type: "image", content: summary, mediaName: null }), "📷 Imagen");
    assert.equal(historyContent({ type: "image", content: "este color", mediaName: null }), "📷 Imagen: este color");
    assert.equal(historyContent({ type: "document", content: "📎 cotizacion.pdf", mediaName: "cotizacion.pdf" }), "📎 cotizacion.pdf");
    assert.equal(historyContent({ type: "audio", content: "hola, quería saber", mediaName: null }), "hola, quería saber");
    assert.equal(historyContent({ type: "text", content: "hola", mediaName: null }), "hola");
  });
});
