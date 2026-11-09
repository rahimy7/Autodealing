import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";
// Las imágenes salen de la configuración del cliente, que se resuelve al importar.
// Premier no declara imágenes: se le ponen unas de prueba encima, con los nombres
// apagados, para ejercitar las dos funciones del core.
process.env.CLIENT_ID = "premier";
process.env.CLIENT_CONFIG_JSON = JSON.stringify({"business": {"agentsIntroduceByName": false, "agentImages": {"cuentas": {"url": "/clients/premier/logo.png", "description": "las dos cuentas para transferir, juntas"}, "cuenta-pesos": {"url": "/clients/premier/logo.png", "description": "la cuenta en pesos"}, "cuenta-dolares": {"url": "/clients/premier/logo.png", "description": "la cuenta en dólares"}, "formas-pago": {"url": "/clients/premier/logo.png", "description": "las formas de pago"}, "envio": {"url": "/clients/premier/logo.png", "description": "las opciones de envío"}, "como-comprar": {"url": "/clients/premier/logo.png", "description": "la imagen de la tienda en línea", "placement": "before"}}}});

const { publicBaseUrl, toPublicUrl } = await import("../src/lib/public-url.js");
const { buildSystemPrompt, IMAGE_DIRECTIVE, ECHOED_TIMESTAMP, asksToResend, linksIn, removeLinks, channelPromptBlock } = await import(
  "../src/lib/openai-client.js"
);
const { sanitizeAiEmailReply } = await import("../src/lib/email-format.js");

describe("public-url", () => {
  it("prefers PUBLIC_BASE_URL and falls back to Railway's public domain", () => {
    assert.equal(publicBaseUrl({ PUBLIC_BASE_URL: "https://chat.cliente.do/", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }), "https://chat.cliente.do");
    assert.equal(publicBaseUrl({ RAILWAY_PUBLIC_DOMAIN: "redessociales-production.up.railway.app" }), "https://redessociales-production.up.railway.app");
    assert.equal(publicBaseUrl({}), null);
  });

  it("completes a panel path and leaves absolute URLs alone", () => {
    const env = { RAILWAY_PUBLIC_DOMAIN: "redessociales-production.up.railway.app" };
    assert.equal(
      toPublicUrl("/clients/premier/logo.png", env),
      "https://redessociales-production.up.railway.app/clients/premier/logo.png",
    );
    assert.equal(toPublicUrl("https://cdn.shopify.com/a.jpg", {}), "https://cdn.shopify.com/a.jpg");
    assert.equal(toPublicUrl("/clients/a.jpg", {}), null);
  });
});

describe("agent images — prompt and markers", () => {
  const base = { agentName: "Daniela", customPrompt: null };

  it("teaches the declared images to the profiles that can send pictures", () => {
    const prompt = buildSystemPrompt({ ...base, profileType: "sales" });
    assert.match(prompt, /Imágenes que puedes enviar/);
    assert.match(prompt, /\[\[IMAGEN:cuentas\]\]: las dos cuentas para transferir, juntas/);
    // Cada cuenta por separado: la que se manda depende de dónde está el cliente.
    assert.match(prompt, /\[\[IMAGEN:cuenta-pesos\]\]: la cuenta en pesos/);
    assert.match(prompt, /\[\[IMAGEN:cuenta-dolares\]\]: la cuenta en dólares/);
    assert.match(prompt, /\[\[IMAGEN:formas-pago\]\]/);
    assert.match(prompt, /\[\[IMAGEN:envio\]\]/);
    // La imagen de la tienda, que va con el mensaje de cómo comprar.
    assert.match(prompt, /\[\[IMAGEN:como-comprar\]\]: la imagen de la tienda en línea/);
  });

  it("only the store image goes ahead of the text; the accounts still close the message", async () => {
    const { clientConfig } = await import("../src/lib/client-config.js");
    const images = clientConfig.business.agentImages;
    assert.equal(images["como-comprar"].placement, "before");
    for (const key of ["cuentas", "cuenta-pesos", "cuenta-dolares", "formas-pago", "envio"]) {
      assert.equal(images[key].placement, "after", key);
    }
  });

  it("keeps them away from the agenda and qualifier profiles", () => {
    assert.doesNotMatch(buildSystemPrompt({ ...base, profileType: "reservations" }), /\[\[IMAGEN:/);
    assert.doesNotMatch(buildSystemPrompt({ ...base, profileType: "qualifier" }), /\[\[IMAGEN:/);
  });

  it("reads the key from the marker and strips it from the text", () => {
    const reply = "Te comparto las cuentas para la transferencia 👇 [[IMAGEN: cuentas ]]";
    assert.deepEqual([...reply.matchAll(IMAGE_DIRECTIVE)].map((m) => m[1]), ["cuentas"]);
    assert.equal(reply.replace(IMAGE_DIRECTIVE, "").trim(), "Te comparto las cuentas para la transferencia 👇");
  });

  it("strips the history timestamp the model sometimes copies at the start of a line", () => {
    assert.equal("[15/10 16:43] ¿Qué producto quieres y cuántos?".replace(ECHOED_TIMESTAMP, ""), "¿Qué producto quieres y cuántos?");
    assert.equal("Hola\n[5/9 08:01] ¿En qué país?".replace(ECHOED_TIMESTAMP, ""), "Hola\n¿En qué país?");
    // Los corchetes que no son una hora, o que no abren la línea, se quedan.
    assert.equal("[[IMAGEN:cuentas]]".replace(ECHOED_TIMESTAMP, ""), "[[IMAGEN:cuentas]]");
    assert.equal("Llega el [15/10]".replace(ECHOED_TIMESTAMP, ""), "Llega el [15/10]");
  });

  it("never leaves the marker in an email reply", () => {
    assert.equal(sanitizeAiEmailReply("Estas son las cuentas. [[IMAGEN:cuentas]]").text, "Estas son las cuentas.");
  });
});

describe("agent identity — one chat, no names", () => {
  it("does not give the agent a name to introduce itself with when the client turns names off", () => {
    const prompt = buildSystemPrompt({ agentName: "Daniela, Ventas IA", customPrompt: null, profileType: "sales" });
    assert.doesNotMatch(prompt, /Tu nombre es|Daniela/);
    assert.doesNotMatch(prompt, /Di tu nombre/);
    assert.match(prompt, /No te presentes: ni con un nombre/);
    assert.match(prompt, /con el asistente virtual de Premier Line Motors/);
  });

  it("keeps asking only what is needed to move forward", () => {
    const prompt = buildSystemPrompt({ agentName: "Sofía", customPrompt: null, profileType: "support" });
    assert.match(prompt, /Pregunta solo lo imprescindible para avanzar/);
  });
});

describe("agent channel — WhatsApp, Instagram or Facebook", () => {
  const base = { agentName: "Daniela", customPrompt: null, profileType: "sales" };

  it("on WhatsApp gives the customer's number as their phone", () => {
    const block = channelPromptBlock("whatsapp", "18097878732");
    assert.ok(block);
    assert.match(block, /CANAL DE ESTA CONVERSACIÓN: WhatsApp\./);
    assert.match(block, /desde el número \+18097878732: ese es su teléfono, no se lo pidas/);
    assert.match(channelPromptBlock("whatsapp", null) ?? "", /su número no está disponible/);
  });

  it("on Instagram and Facebook says there is no phone and it is not WhatsApp", () => {
    const instagram = channelPromptBlock("instagram", "18097878732");
    assert.ok(instagram);
    assert.match(instagram, /CANAL DE ESTA CONVERSACIÓN: Instagram \(mensaje directo\)\./);
    assert.match(instagram, /te escribe por Instagram, no por WhatsApp: no tienes su teléfono/);
    assert.match(instagram, /aquí es este chat de Instagram/);
    assert.doesNotMatch(instagram, /\+18097878732/);

    const facebook = channelPromptBlock("facebook", null);
    assert.ok(facebook);
    assert.match(facebook, /CANAL DE ESTA CONVERSACIÓN: Facebook Messenger\./);
    assert.match(facebook, /aquí es este chat de Facebook/);
  });

  it("reaches the system prompt only when the conversation has a channel", () => {
    assert.match(buildSystemPrompt({ ...base, channel: "instagram" }), /CANAL DE ESTA CONVERSACIÓN: Instagram/);
    assert.doesNotMatch(buildSystemPrompt(base), /CANAL DE ESTA CONVERSACIÓN/);
    assert.equal(channelPromptBlock("email", null), null);
  });
});

describe("agent replies — nothing the customer already has", () => {
  const link = "https://procollagenvitalessence.com/products/procollagen";

  it("asks for the product photo and link only the first time", () => {
    const prompt = buildSystemPrompt({ agentName: "Sofía", customPrompt: null, profileType: "support" });
    assert.match(prompt, /La primera vez que nombres un producto concreto en la conversación, termina el mensaje con \[\[FOTO:/);
    assert.doesNotMatch(prompt, /Siempre que nombres un producto/);
  });

  it("drops the link that the photo caption already carries", () => {
    assert.equal(
      removeLinks(`Sí, tenemos Procollagen. Cuesta US$100. ${link}`, [link]),
      "Sí, tenemos Procollagen. Cuesta US$100.",
    );
    assert.equal(
      removeLinks(`Perfecto, te confirmo 1 Procollagen — US$100. ${link}\n\n¿Me das el nombre de quien recibe?`, [link]),
      "Perfecto, te confirmo 1 Procollagen — US$100.\n\n¿Me das el nombre de quien recibe?",
    );
  });

  it("does not leave doubled punctuation or empty parentheses behind", () => {
    assert.equal(removeLinks(`Cuesta US$100. ${link}.`, [link]), "Cuesta US$100.");
    assert.equal(removeLinks(`Cuesta US$100 (${link}).`, [link]), "Cuesta US$100.");
    assert.equal(removeLinks(`Mira la ficha: ${link}/`, [link]), "Mira la ficha:");
  });

  it("keeps links the customer does not have yet, and never empties the reply", () => {
    const nad = "https://procollagenvitalessence.com/products/nad-advanced";
    assert.equal(removeLinks(`El NAD Advanced está en US$78. ${nad}`, [link]), `El NAD Advanced está en US$78. ${nad}`);
    assert.equal(removeLinks(link, [link]), link);
    assert.equal(removeLinks("Sin enlaces.", []), "Sin enlaces.");
  });

  it("reads links without the punctuation that follows them", () => {
    assert.deepEqual(linksIn(`Aquí: ${link}. Y ${link}/?x=1`), [link, `${link}/?x=1`]);
  });

  it("resends only when the customer asks for it again", () => {
    assert.ok(asksToResend("pásame la foto otra vez"));
    assert.ok(asksToResend("¿Me mandas las cuentas de nuevo?"));
    assert.ok(asksToResend("mándame el link"));
    assert.ok(!asksToResend("sí"));
    assert.ok(!asksToResend("Dólares (US$)"));
  });
});
