import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// La pausa entre una imagen y el texto que la sigue (Messenger/Instagram), corta
// para que el test no espere los 2,5 s de producción.
process.env.META_ATTACHMENT_SETTLE_MS = "40";

const {
  verifyWebhookSignature,
  parseInboundEvents,
  parseInboundCommentEvents,
  deliverChoiceMessage,
  deliverInteractiveMessage,
  summarizeDeliveryReceipt,
  settingsForNumber,
  whatsappRecipient,
  describeWebhookOrigin,
} = await import("../src/lib/meta.js");

function signBody(secret: string, body: Buffer): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("lib/meta — verifyWebhookSignature", () => {
  const body = Buffer.from('{"object":"page","entry":[]}', "utf8");

  it("passes when no app secret is configured (dev/test mode)", () => {
    assert.equal(verifyWebhookSignature(null, body, "sha256=whatever"), true);
    assert.equal(verifyWebhookSignature(null, undefined, undefined), true);
  });

  it("fails when a secret is set but the header is missing", () => {
    assert.equal(verifyWebhookSignature("s3cret", body, undefined), false);
  });

  it("fails when the raw body is missing", () => {
    assert.equal(verifyWebhookSignature("s3cret", undefined, "sha256=abc"), false);
  });

  it("passes with a correctly signed body", () => {
    const sig = signBody("s3cret", body);
    assert.equal(verifyWebhookSignature("s3cret", body, sig), true);
  });

  it("fails when the signature was made with a different secret", () => {
    const sig = signBody("other-secret", body);
    assert.equal(verifyWebhookSignature("s3cret", body, sig), false);
  });

  it("fails when the body was mutated after signing", () => {
    const sig = signBody("s3cret", body);
    const mutated = Buffer.from(body.toString("utf8") + " ", "utf8");
    assert.equal(verifyWebhookSignature("s3cret", mutated, sig), false);
  });

  it("accepts a webhook signed by the Instagram app secret alongside the Meta app secret", () => {
    // Instagram con inicio de sesión con Instagram firma con la clave de la app de
    // Instagram; WhatsApp y Messenger, con la de la app de Meta. Llegan a la misma URL.
    const igBody = Buffer.from('{"object":"instagram","entry":[]}', "utf8");
    const secrets = ["meta-secret", "instagram-secret"];
    assert.equal(verifyWebhookSignature(secrets, igBody, signBody("instagram-secret", igBody)), true);
    assert.equal(verifyWebhookSignature(secrets, body, signBody("meta-secret", body)), true);
    assert.equal(verifyWebhookSignature(secrets, igBody, signBody("someone-else", igBody)), false);
  });

  it("ignores unset secrets in the list and still skips when none is configured", () => {
    assert.equal(verifyWebhookSignature(["meta-secret", null], body, signBody("meta-secret", body)), true);
    assert.equal(verifyWebhookSignature([null, undefined], body, "sha256=whatever"), true);
    // Sin la clave de Instagram, un webhook de Instagram firmado con ella se rechaza:
    // es exactamente el fallo que dejaba fuera todos los DM.
    const igBody = Buffer.from('{"object":"instagram","entry":[]}', "utf8");
    assert.equal(verifyWebhookSignature(["meta-secret", null], igBody, signBody("instagram-secret", igBody)), false);
  });
});

describe("lib/meta — parseInboundEvents (WhatsApp Cloud API)", () => {
  it("parses a text message with profile name", () => {
    const events = parseInboundEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: "18095551234", profile: { name: "Ana" } }],
                messages: [
                  {
                    id: "wamid.ABC",
                    from: "18095551234",
                    type: "text",
                    text: { body: "Hola, quiero cotizar" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "whatsapp");
    assert.equal(events[0].senderId, "18095551234");
    assert.equal(events[0].senderName, "Ana");
    assert.equal(events[0].text, "Hola, quiero cotizar");
    assert.equal(events[0].externalMessageId, "wamid.ABC");
    assert.equal(events[0].audio, null);
    assert.equal(events[0].replyToExternalId, null);
  });

  it("toma de context.id el mensaje que el cliente citó al responder", () => {
    const events = parseInboundEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.REPLY",
                    from: "18095551234",
                    type: "text",
                    text: { body: "¿Y el viernes a qué hora?" },
                    context: { from: "18094846649", id: "wamid.ORIGINAL" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(events[0].replyToExternalId, "wamid.ORIGINAL");
  });

  it("toma de reply_to.mid la cita en Messenger e Instagram", () => {
    const events = parseInboundEvents({
      object: "instagram",
      entry: [
        {
          messaging: [
            {
              sender: { id: "IGSID1" },
              message: { mid: "m_REPLY", text: "sí, ese", reply_to: { mid: "m_ORIGINAL" } },
            },
          ],
        },
      ],
    });
    assert.equal(events[0].externalMessageId, "m_REPLY");
    assert.equal(events[0].replyToExternalId, "m_ORIGINAL");
  });

  it("parses a WhatsApp audio message as {mediaId,url:null}", () => {
    const events = parseInboundEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.AUDIO",
                    from: "18095551234",
                    type: "audio",
                    audio: { id: "media-42", mime_type: "audio/ogg; codecs=opus" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].text, null);
    assert.deepEqual(events[0].audio, {
      mediaId: "media-42",
      url: null,
      mimeType: "audio/ogg; codecs=opus",
    });
  });

  it("skips status/reaction/echo events (no messages array)", () => {
    const events = parseInboundEvents({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered" }] } }] }],
    });
    assert.equal(events.length, 0);
  });

  // Desde abril de 2026 quien usa nombre de usuario puede llegar sin `from`, solo
  // con su BSUID. Antes esos mensajes se descartaban sin dejar rastro.
  function waFrom(message: Record<string, unknown>, contact: Record<string, unknown>) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [contact],
                messages: [{ id: "wamid.U", type: "text", text: { body: "Hola" }, ...message }],
              },
            },
          ],
        },
      ],
    };
  }

  it("recibe al cliente que llega sin teléfono, solo con su BSUID", () => {
    const events = parseInboundEvents(
      waFrom({ from_user_id: "DO.1349120865" }, { user_id: "DO.1349120865", profile: { name: "Ana" } }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].senderId, "DO.1349120865");
    assert.equal(events[0].senderUserId, "DO.1349120865");
    assert.equal(events[0].senderName, "Ana");
    assert.equal(events[0].text, "Hola");
  });

  it("con teléfono y BSUID el cliente sigue identificado por el teléfono", () => {
    const events = parseInboundEvents(
      waFrom(
        { from: "18095551234", from_user_id: "DO.1349120865" },
        { wa_id: "18095551234", user_id: "DO.1349120865", profile: { name: "Ana" } },
      ),
    );
    assert.equal(events[0].senderId, "18095551234");
    assert.equal(events[0].senderUserId, "DO.1349120865");
    assert.equal(events[0].senderName, "Ana");
  });

  it("toma el nombre de usuario cuando el perfil no trae nombre", () => {
    const events = parseInboundEvents(
      waFrom({ from_user_id: "DO.1349120865" }, { user_id: "DO.1349120865", profile: { username: "ana.rd" } }),
    );
    assert.equal(events[0].senderName, "ana.rd");
  });

  it("a un BSUID se le escribe con recipient; a un teléfono, con to", () => {
    assert.deepEqual(whatsappRecipient("DO.1349120865"), { recipient: "DO.1349120865" });
    assert.deepEqual(whatsappRecipient("18095551234"), { to: "18095551234" });
  });
});

describe("lib/meta — parseInboundEvents (Messenger / Instagram)", () => {
  it("parses a Messenger text message", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "PSID_1" },
              message: { mid: "m_1", text: "hola por messenger" },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "facebook");
    assert.equal(events[0].senderId, "PSID_1");
    assert.equal(events[0].text, "hola por messenger");
    assert.equal(events[0].externalMessageId, "m_1");
  });

  it("parses an Instagram text message", () => {
    const events = parseInboundEvents({
      object: "instagram",
      entry: [
        {
          messaging: [
            {
              sender: { id: "IGSID_1" },
              message: { mid: "m_ig", text: "hola por ig" },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "instagram");
    assert.equal(events[0].senderId, "IGSID_1");
    assert.equal(events[0].text, "hola por ig");
  });

  it("skips outbound echoes (is_echo=true)", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "PSID_1" },
              message: { is_echo: true, mid: "m_1", text: "outbound reply" },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 0);
  });

  it("parses a Messenger audio attachment as {url,mediaId:null}", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "PSID_1" },
              message: {
                mid: "m_audio",
                attachments: [
                  { type: "audio", payload: { url: "https://cdn.example.com/x.mp4" } },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].text, null);
    assert.deepEqual(events[0].audio, {
      mediaId: null,
      url: "https://cdn.example.com/x.mp4",
      mimeType: null,
    });
  });
});

describe("lib/meta — parseInboundEvents (defensive)", () => {
  it("returns [] for unrelated / malformed payloads", () => {
    assert.deepEqual(parseInboundEvents(null), []);
    assert.deepEqual(parseInboundEvents({}), []);
    assert.deepEqual(parseInboundEvents({ object: "unknown", entry: [{}] }), []);
    assert.deepEqual(parseInboundEvents("not-an-object"), []);
  });
});

describe("lib/meta — parseInboundCommentEvents (Facebook feed)", () => {
  it("parses a root comment (verb=add, item=comment)", () => {
    const events = parseInboundCommentEvents({
      object: "page",
      entry: [
        {
          id: "PAGE_ID",
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "POST_1_COMMENT_1",
                post_id: "PAGE_ID_POST_1",
                parent_id: "PAGE_ID_POST_1",
                message: "¿Cuál es la dirección?",
                from: { id: "USER_ASID_1", name: "Ana" },
                created_time: 1720000000,
                permalink_url: "https://facebook.com/permalink",
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      channel: "facebook",
      externalPostId: "PAGE_ID_POST_1",
      externalCommentId: "POST_1_COMMENT_1",
      parentExternalCommentId: null,
      rootExternalCommentId: "POST_1_COMMENT_1",
      authorExternalId: "USER_ASID_1",
      authorName: "Ana",
      text: "¿Cuál es la dirección?",
      permalink: "https://facebook.com/permalink",
      createdAt: new Date(1720000000 * 1000),
    });
  });

  it("recognizes replies inside a thread (parent_id != post_id)", () => {
    const events = parseInboundCommentEvents({
      object: "page",
      entry: [
        {
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "POST_1_COMMENT_2",
                post_id: "PAGE_ID_POST_1",
                parent_id: "POST_1_COMMENT_1",
                message: "gracias",
                from: { id: "USER_ASID_2", name: "Bea" },
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].parentExternalCommentId, "POST_1_COMMENT_1");
    assert.equal(events[0].rootExternalCommentId, "POST_1_COMMENT_1");
  });

  it("skips echoes authored by the page itself", () => {
    const events = parseInboundCommentEvents(
      {
        object: "page",
        entry: [
          {
            changes: [
              {
                field: "feed",
                value: {
                  item: "comment",
                  verb: "add",
                  comment_id: "OUR_REPLY",
                  post_id: "PAGE_ID_POST_1",
                  message: "hola",
                  from: { id: "PAGE_ID" },
                },
              },
            ],
          },
        ],
      },
      { pageId: "PAGE_ID" },
    );
    assert.deepEqual(events, []);
  });

  it("skips non-add verbs (edits, deletes, reactions)", () => {
    const events = parseInboundCommentEvents({
      object: "page",
      entry: [
        {
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "edited",
                comment_id: "X",
                post_id: "P",
                message: "…",
                from: { id: "USER" },
              },
            },
            {
              field: "feed",
              value: { item: "reaction", verb: "add", from: { id: "USER" } },
            },
          ],
        },
      ],
    });
    assert.deepEqual(events, []);
  });
});

describe("lib/meta — parseInboundCommentEvents (Instagram)", () => {
  it("parses an IG comment", () => {
    const events = parseInboundCommentEvents({
      object: "instagram",
      entry: [
        {
          id: "IG_BUSINESS_ID",
          changes: [
            {
              field: "comments",
              value: {
                id: "IG_COMMENT_1",
                text: "¿tienen esta pintura?",
                from: { id: "IG_USER_1", username: "ana" },
                media: { id: "IG_MEDIA_1" },
              },
            },
          ],
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, "instagram");
    assert.equal(events[0].externalPostId, "IG_MEDIA_1");
    assert.equal(events[0].externalCommentId, "IG_COMMENT_1");
    assert.equal(events[0].authorExternalId, "IG_USER_1");
    assert.equal(events[0].authorName, "ana");
    assert.equal(events[0].parentExternalCommentId, null);
  });

  it("ignores echoes from our own IG business account", () => {
    const events = parseInboundCommentEvents(
      {
        object: "instagram",
        entry: [
          {
            changes: [
              {
                field: "comments",
                value: {
                  id: "IG_COMMENT_ECHO",
                  text: "reply",
                  from: { id: "IG_BUSINESS_ID" },
                  media: { id: "IG_MEDIA_1" },
                },
              },
            ],
          },
        ],
      },
      { instagramAccountId: "IG_BUSINESS_ID" },
    );
    assert.deepEqual(events, []);
  });
});

describe("lib/meta — parseInboundCommentEvents (defensive)", () => {
  it("returns [] for DM payloads and malformed input", () => {
    assert.deepEqual(parseInboundCommentEvents(null), []);
    assert.deepEqual(parseInboundCommentEvents({}), []);
    // A pure DM payload (no changes[]) yields no comment events.
    assert.deepEqual(
      parseInboundCommentEvents({
        object: "page",
        entry: [{ messaging: [{ sender: { id: "1" }, message: { text: "hi" } }] }],
      }),
      [],
    );
  });
});

describe("lib/meta — parseInboundEvents: pulsaciones de botón", () => {
  it("convierte un interactive/button_reply de WhatsApp en un turno de texto con buttonId", () => {
    const events = parseInboundEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: "18095551234", profile: { name: "Ana" } }],
                messages: [
                  {
                    from: "18095551234",
                    id: "wamid.1",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: { id: "ver-ofertas", title: "Ver ofertas" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].text, "Ver ofertas");
    assert.equal(events[0].buttonId, "ver-ofertas");
    assert.equal(events[0].channel, "whatsapp");
    assert.equal(events[0].senderName, "Ana");
  });

  it("recoge el payload de una quick reply de Messenger/Instagram", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "PSID_1" },
              message: {
                mid: "m.1",
                text: "Hablar con asesor",
                quick_reply: { payload: "hablar-asesor" },
              },
            },
          ],
        },
      ],
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].text, "Hablar con asesor");
    assert.equal(events[0].buttonId, "hablar-asesor");
  });

  it("un mensaje escrito a mano no trae buttonId", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID_2" }, message: { mid: "m.2", text: "hola" } }] }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].buttonId, undefined);
  });
});

// ── Lista de opciones (más de las que caben en botones) ───────────────────────
// La pregunta de la sucursal son 5 opciones: WhatsApp solo admite 3 botones, así
// que va como interactivo de tipo lista. Un payload mal formado no falla en
// silencio — WhatsApp devuelve error y el cliente se queda sin la pregunta —,
// pero tampoco se nota hasta producción; de ahí este test.
describe("meta — deliverChoiceMessage", () => {
  const settings = {
    whatsappEnabled: true,
    whatsappPhoneNumberId: "PHONE",
    whatsappAccessToken: "TOKEN",
    facebookEnabled: true,
    facebookPageAccessToken: "PAGE",
    instagramEnabled: true,
    instagramAccessToken: "IG",
  } as Parameters<typeof deliverChoiceMessage>[0];

  const options = [
    { id: "zona:a", label: "Alma Rosa", description: "Santo Domingo Este, Los Mina" },
    { id: "zona:b", label: "Serrallés", description: "Distrito Nacional" },
    { id: "zona:c", label: "Santiago", description: "Cibao" },
    { id: "zona:d", label: "La Romana", description: "San Pedro" },
    { id: "zona:e", label: "Bávaro", description: "Punta Cana" },
  ];

  async function capture(channel: "whatsapp" | "facebook") {
    const original = globalThis.fetch;
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    try {
      await deliverChoiceMessage(settings, channel, "RECIPIENT", {
        text: "¿En qué zona estás?",
        actionLabel: "Ver tiendas",
        options,
      });
    } finally {
      globalThis.fetch = original;
    }
    return body;
  }

  it("en WhatsApp manda una lista con una fila por tienda", async () => {
    const body = (await capture("whatsapp")) as {
      type: string;
      interactive: { type: string; action: { button: string; sections: Array<{ rows: Array<{ id: string; title: string; description?: string }> }> } };
    };
    assert.equal(body.type, "interactive");
    assert.equal(body.interactive.type, "list");
    assert.equal(body.interactive.action.button, "Ver tiendas");
    const rows = body.interactive.action.sections[0].rows;
    assert.equal(rows.length, 5, "las 5 tiendas, no 3 como en los botones");
    assert.deepEqual(rows[2], { id: "zona:c", title: "Santiago", description: "Cibao" });
  });

  it("en Messenger/Instagram van como quick replies", async () => {
    const body = (await capture("facebook")) as {
      message: { text: string; quick_replies: Array<{ title: string; payload: string }> };
    };
    assert.equal(body.message.quick_replies.length, 5);
    assert.deepEqual(body.message.quick_replies[4], {
      content_type: "text",
      title: "Bávaro",
      payload: "zona:e",
    });
  });
});

describe("lib/meta — describeWebhookOrigin", () => {
  it("dice de qué cuenta, campo y número viene un webhook", () => {
    const origen = describeWebhookOrigin({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "OTRA_WABA",
          changes: [
            { field: "messages", value: { metadata: { display_phone_number: "18095551234" } } },
            { field: "messages", value: { statuses: [] } },
          ],
        },
      ],
    });
    assert.deepEqual(origen, {
      object: "whatsapp_business_account",
      accounts: ["OTRA_WABA"],
      fields: ["messages"],
      numbers: ["18095551234"],
    });
  });

  it("no se cae con un cuerpo que no reconoce", () => {
    assert.deepEqual(describeWebhookOrigin({ hola: 1 }), {
      object: null,
      accounts: [],
      fields: [],
      numbers: [],
    });
  });
});

describe("lib/meta — summarizeDeliveryReceipt", () => {
  // Cuerpo real de un acuse de WhatsApp, recortado a lo que lee la función.
  const receipt = (status: string) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1438133463993189",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "766302823222313" },
              statuses: [{ id: "wamid.ABC", status, recipient_id: "18097572575" }],
            },
          },
        ],
      },
    ],
  });

  it("resume los tres acuses que genera cada mensaje enviado", () => {
    for (const status of ["sent", "delivered", "read"]) {
      assert.deepEqual(summarizeDeliveryReceipt(receipt(status)), {
        statuses: [status],
        recipients: ["18097572575"],
      });
    }
  });

  it("devuelve null cuando el webhook trae mensajes, para que se vuelque entero", () => {
    const body = receipt("sent");
    (body.entry[0].changes[0].value as Record<string, unknown>).messages = [
      { from: "18097572575", type: "text", text: { body: "hola" } },
    ];
    assert.equal(summarizeDeliveryReceipt(body), null);
  });

  it("devuelve null ante una forma que no reconoce", () => {
    assert.equal(summarizeDeliveryReceipt({ object: "page", entry: [] }), null);
    assert.equal(summarizeDeliveryReceipt({ object: "whatsapp_business_account", entry: [] }), null);
    assert.equal(summarizeDeliveryReceipt(null), null);
  });
});

// ── Varios números por instancia ──────────────────────────────────────────────
// Todo el mecanismo de "responde por el mismo número que recibió el mensaje"
// cuelga de un solo dato del webhook: value.metadata.phone_number_id. Si el
// parser dejara de leerlo, las respuestas seguirían saliendo —por el número
// principal— y el fallo solo se vería cuando un cliente de Soporte recibiera la
// contestación desde Ventas. Estos tests fijan ese dato y la resolución de
// credenciales que se apoya en él.
describe("meta — varios números de WhatsApp", () => {
  function waBody(phoneNumberId: string | null, text = "hola") {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                ...(phoneNumberId ? { metadata: { phone_number_id: phoneNumberId } } : {}),
                contacts: [{ wa_id: "18095551234", profile: { name: "Ana" } }],
                messages: [
                  { from: "18095551234", id: "wamid.1", type: "text", text: { body: text } },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  it("lee a cuál de nuestros números llegó el mensaje", () => {
    const events = parseInboundEvents(waBody("VENTAS_ID"));
    assert.equal(events.length, 1);
    assert.equal(events[0].recipientNumberId, "VENTAS_ID");
  });

  it("distingue dos números en webhooks distintos", () => {
    assert.equal(parseInboundEvents(waBody("VENTAS_ID"))[0].recipientNumberId, "VENTAS_ID");
    assert.equal(parseInboundEvents(waBody("SOPORTE_ID"))[0].recipientNumberId, "SOPORTE_ID");
  });

  it("no se cae si el webhook viene sin metadata", () => {
    const events = parseInboundEvents(waBody(null));
    assert.equal(events.length, 1);
    assert.equal(events[0].recipientNumberId, null);
  });

  it("Messenger e Instagram no traen número receptor", () => {
    const events = parseInboundEvents({
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID" }, message: { mid: "m1", text: "hola" } }] }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].recipientNumberId ?? null, null);
  });

  const shared = {
    whatsappEnabled: true,
    whatsappPhoneNumberId: "PRINCIPAL",
    whatsappAccessToken: "TOKEN_COMPARTIDO",
  } as Parameters<typeof settingsForNumber>[0];

  it("envía por el número indicado, heredando el token compartido", () => {
    const out = settingsForNumber(shared, { phoneNumberId: "SOPORTE_ID", accessToken: null });
    assert.equal(out.whatsappPhoneNumberId, "SOPORTE_ID");
    assert.equal(out.whatsappAccessToken, "TOKEN_COMPARTIDO");
  });

  it("usa el token propio del número cuando lo tiene", () => {
    const out = settingsForNumber(shared, { phoneNumberId: "OTRA_WABA", accessToken: "TOKEN_PROPIO" });
    assert.equal(out.whatsappPhoneNumberId, "OTRA_WABA");
    assert.equal(out.whatsappAccessToken, "TOKEN_PROPIO");
  });

  it("sin número resuelto deja la configuración compartida intacta", () => {
    const out = settingsForNumber(shared, null);
    assert.equal(out.whatsappPhoneNumberId, "PRINCIPAL");
    assert.equal(out.whatsappAccessToken, "TOKEN_COMPARTIDO");
  });
});

// ── Imagen y texto en Messenger/Instagram ─────────────────────────────────────
// Ahí la imagen y el texto son dos mensajes, y Meta baja la imagen de su enlace
// mientras procesa el envío: el texto, mandado justo detrás, le llegaba al
// cliente antes (2026-10-15, "la imagen sale de último en el mensaje de
// bienvenida"). La imagen va primero y el texto espera la pausa.
describe("meta — deliverInteractiveMessage con imagen en Instagram", () => {
  const settings = {
    instagramEnabled: true,
    instagramAccessToken: "IG",
  } as Parameters<typeof deliverInteractiveMessage>[0];

  it("manda la imagen, espera y después el texto con los botones", async () => {
    const original = globalThis.fetch;
    const sent: Array<{ at: number; message: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent.push({ at: Date.now(), message: JSON.parse(init.body).message });
      return { ok: true, json: async () => ({ message_id: `mid.${sent.length}` }) };
    }) as unknown as typeof fetch;
    try {
      const result = await deliverInteractiveMessage(settings, "instagram", "IGSID", {
        text: "COMPRA EN LÍNEA",
        imageUrl: "https://cdn.example.com/bienvenida.jpg",
        buttons: [{ id: "comprar", label: "Comprar" }],
      });
      assert.equal(result.ok, true);
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(sent.length, 2);
    assert.ok("attachment" in sent[0].message, "primero la imagen");
    assert.equal(sent[1].message.text, "COMPRA EN LÍNEA");
    assert.ok(sent[1].at - sent[0].at >= 35, "el texto espera a que la imagen llegue");
  });
});
