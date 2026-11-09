import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  UspsError,
  forgetUspsTokens,
  parseMultipart,
  pdfFromPart,
  testUspsConnection,
  uspsBaseUrl,
  uspsCancelLabel,
  uspsCreateLabel,
  uspsErrorMessage,
  uspsPaymentToken,
  uspsTrack,
  uspsValidateAddress,
  type UspsCredentials,
  type UspsLabelRequest,
} from "../src/lib/usps";

const creds: UspsCredentials = {
  environment: "test",
  clientId: "key-123",
  clientSecret: "secret-456",
  crid: "1111111",
  mid: "902222222",
  manifestMid: null,
  accountNumber: "1000000099",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let responder: (call: Call) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0a]), Buffer.from("%%EOF")]);

function multipartLabel(opts: { base64?: boolean; metadata?: Record<string, unknown> } = {}): Response {
  const meta = opts.metadata ?? {
    trackingNumber: "9400111899223197428490",
    postage: 7.99,
    extraServices: [{ name: "USPS Tracking", price: 0 }],
    fees: [],
    commitment: { name: "2 Days", scheduleDeliveryDate: "2026-10-23" },
  };
  const boundary = "XkxytuhvSSXDz";
  const pdf = opts.base64 ? Buffer.from(PDF.toString("base64"), "latin1") : PDF;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\nContent-Disposition: form-data; name="labelMetadata"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: form-data; filename="labelImage.pdf"; name="labelImage"\r\n\r\n`),
    pdf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Response(body, { status: 200, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
}

const labelRequest: UspsLabelRequest = {
  from: { firstName: "Procollagen", lastName: "Vital Essence", streetAddress: "100 Warehouse Way", secondaryAddress: null, city: "Orlando", state: "FL", ZIPCode: "32801" },
  to: { firstName: "Juan", lastName: "Pérez", streetAddress: "123 Main St", secondaryAddress: "Apt 4", city: "Miami", state: "FL", ZIPCode: "33101", ZIPPlus4: null },
  mailClass: "USPS_GROUND_ADVANTAGE",
  weightLb: 0.75,
  lengthIn: 9,
  widthIn: 6,
  heightIn: 3,
  mailingDate: "2026-10-21",
};

beforeEach(() => {
  forgetUspsTokens();
  calls = [];
  responder = (call) => {
    if (call.url.endsWith("/oauth2/v3/token")) return json({ access_token: "oauth-token", expires_in: 28800 });
    if (call.url.endsWith("/payments/v3/payment-authorization")) return json({ paymentAuthorizationToken: "pay-token" });
    throw new Error(`sin respuesta preparada para ${call.method} ${call.url}`);
  };
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return responder(call);
  });
});

afterEach(() => mock.restoreAll());

describe("ambientes y errores", () => {
  it("pruebas va a apis-tem y producción a apis", () => {
    assert.equal(uspsBaseUrl("test"), "https://apis-tem.usps.com");
    assert.equal(uspsBaseUrl("production"), "https://apis.usps.com");
  });

  it("saca el mensaje de los errores de USPS", () => {
    assert.equal(uspsErrorMessage({ error: { message: "Invalid", errors: [{ detail: "ZIPCode is required" }] } }), "Invalid — ZIPCode is required");
    assert.equal(uspsErrorMessage({ error_description: "bad client" }), "bad client");
    assert.equal(uspsErrorMessage(null), null);
    assert.equal(uspsErrorMessage({}), null);
  });
});

describe("token OAuth y autorización de pago", () => {
  it("canjea el Consumer Key/Secret en el ambiente que toca y reutiliza el token", async () => {
    await uspsValidateAddress(creds, { streetAddress: "1", city: "a", state: "FL", ZIPCode: "33101" }).catch(() => undefined);
    await uspsValidateAddress(creds, { streetAddress: "1", city: "a", state: "FL", ZIPCode: "33101" }).catch(() => undefined);
    const tokenCalls = calls.filter((c) => c.url.endsWith("/oauth2/v3/token"));
    assert.equal(tokenCalls.length, 1);
    assert.equal(tokenCalls[0].url, "https://apis-tem.usps.com/oauth2/v3/token");
    assert.deepEqual(tokenCalls[0].body, { grant_type: "client_credentials", client_id: "key-123", client_secret: "secret-456" });
  });

  it("sin Consumer Key/Secret no sale a la red", async () => {
    await assert.rejects(uspsPaymentToken({ ...creds, clientId: "" }), (e: UspsError) => e.status === 400 && /Consumer Key/.test(e.message));
    assert.equal(calls.length, 0);
  });

  it("la autorización de pago manda al pagador y al dueño con la misma cuenta, y el MID del manifiesto cae al MID", async () => {
    assert.equal(await uspsPaymentToken(creds), "pay-token");
    const payment = calls.find((c) => c.url.endsWith("/payments/v3/payment-authorization"))!;
    assert.equal(payment.headers.authorization, "Bearer oauth-token");
    const roles = (payment.body as { roles: Array<Record<string, string>> }).roles;
    assert.deepEqual(roles.map((r) => r.roleName), ["PAYER", "LABEL_OWNER"]);
    for (const role of roles) {
      assert.deepEqual({ ...role, roleName: undefined }, { roleName: undefined, CRID: "1111111", MID: "902222222", manifestMID: "902222222", accountType: "EPS", accountNumber: "1000000099" });
    }
  });

  it("dice qué falta de la cuenta de pago antes de llamar", async () => {
    await assert.rejects(uspsPaymentToken({ ...creds, crid: "", accountNumber: null }), (e: UspsError) => /CRID, número de cuenta EPS/.test(e.message));
    assert.equal(calls.length, 0);
  });

  it("explica un 401 al canjear el token", async () => {
    responder = () => json({ error: "invalid_client", error_description: "Client authentication failed" }, 401);
    await assert.rejects(uspsPaymentToken(creds), (e: UspsError) => e.status === 400 && /Client authentication failed/.test(e.message) && /pruebas/.test(e.message));
  });

  it("probar la conexión pide el token y, si hay cuenta de pago, su autorización", async () => {
    assert.deepEqual(await testUspsConnection(creds), { payment: true });
    forgetUspsTokens();
    assert.deepEqual(await testUspsConnection({ ...creds, accountNumber: null }), { payment: false });
  });
});

describe("uspsCreateLabel", () => {
  it("compra la etiqueta con los dos tokens y lee la guía, el franqueo y el PDF", async () => {
    responder = (call) => {
      if (call.url.endsWith("/oauth2/v3/token")) return json({ access_token: "oauth-token", expires_in: 28800 });
      if (call.url.endsWith("/payments/v3/payment-authorization")) return json({ paymentAuthorizationToken: "pay-token" });
      if (call.url.endsWith("/labels/v3/label")) return multipartLabel();
      throw new Error(call.url);
    };
    const label = await uspsCreateLabel(creds, labelRequest);
    assert.equal(label.trackingNumber, "9400111899223197428490");
    assert.equal(label.postageCents, 799);
    assert.equal(label.extraCents, 0);
    assert.equal(label.commitmentName, "2 Days");
    assert.equal(label.commitmentDate, "2026-10-23");
    assert.ok(label.pdf.equals(PDF), "el PDF llega intacto, byte por byte");

    const request = calls.find((c) => c.url.endsWith("/labels/v3/label"))!;
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer oauth-token");
    assert.equal(request.headers["x-payment-authorization-token"], "pay-token");
    const body = request.body as { toAddress: Record<string, string>; fromAddress: Record<string, string>; packageDescription: Record<string, unknown>; imageInfo: unknown };
    assert.deepEqual(body.imageInfo, { imageType: "PDF" });
    assert.deepEqual(body.toAddress, { firstName: "Juan", lastName: "Pérez", streetAddress: "123 Main St", secondaryAddress: "Apt 4", city: "Miami", state: "FL", ZIPCode: "33101" });
    assert.equal(body.fromAddress.secondaryAddress, undefined, "lo vacío no se manda");
    assert.deepEqual(body.packageDescription, {
      mailClass: "USPS_GROUND_ADVANTAGE",
      rateIndicator: "SP",
      weightUOM: "lb",
      weight: 0.75,
      dimensionsUOM: "in",
      length: 9,
      width: 6,
      height: 3,
      processingCategory: "MACHINABLE",
      mailingDate: "2026-10-21",
      destinationEntryFacilityType: "NONE",
    });
  });

  it("acepta el PDF en base64", async () => {
    responder = (call) => (call.url.endsWith("/labels/v3/label") ? multipartLabel({ base64: true }) : call.url.endsWith("/payments/v3/payment-authorization") ? json({ paymentAuthorizationToken: "p" }) : json({ access_token: "t" }));
    const label = await uspsCreateLabel(creds, labelRequest);
    assert.ok(label.pdf.equals(PDF));
  });

  it("si el token OAuth caducó (401), lo renueva y repite sin comprar dos veces", async () => {
    let labelCalls = 0;
    let tokens = 0;
    responder = (call) => {
      if (call.url.endsWith("/oauth2/v3/token")) return json({ access_token: `oauth-${++tokens}`, expires_in: 28800 });
      if (call.url.endsWith("/payments/v3/payment-authorization")) return json({ paymentAuthorizationToken: "pay" });
      labelCalls++;
      return call.headers.authorization === "Bearer oauth-1" ? json({ error: { message: "expired" } }, 401) : multipartLabel();
    };
    const label = await uspsCreateLabel(creds, labelRequest);
    assert.equal(label.trackingNumber, "9400111899223197428490");
    assert.equal(labelCalls, 2, "el primer intento fue rechazado por 401: no hubo compra");
    assert.equal(tokens, 2);
  });

  it("un rechazo de USPS es definitivo (no se compró) y trae su motivo", async () => {
    responder = (call) =>
      call.url.endsWith("/labels/v3/label")
        ? json({ error: { message: "Invalid request", errors: [{ detail: "toAddress.ZIPCode is invalid" }] } }, 400)
        : call.url.endsWith("/payments/v3/payment-authorization")
          ? json({ paymentAuthorizationToken: "p" })
          : json({ access_token: "t" });
    await assert.rejects(uspsCreateLabel(creds, labelRequest), (e: UspsError) => e.definitive && e.status === 400 && /toAddress\.ZIPCode is invalid/.test(e.message));
  });

  it("un fallo sin respuesta de USPS NO es definitivo: pudo haberse cobrado", async () => {
    responder = (call) => {
      if (call.url.endsWith("/labels/v3/label")) throw new TypeError("fetch failed");
      return call.url.endsWith("/payments/v3/payment-authorization") ? json({ paymentAuthorizationToken: "p" }) : json({ access_token: "t" });
    };
    await assert.rejects(uspsCreateLabel(creds, labelRequest), (e: UspsError) => !e.definitive && /No hubo respuesta de USPS/.test(e.message));
  });

  it("una respuesta 200 sin guía se reporta como posible cobro", async () => {
    responder = (call) =>
      call.url.endsWith("/labels/v3/label")
        ? multipartLabel({ metadata: { postage: 7.99 } })
        : call.url.endsWith("/payments/v3/payment-authorization")
          ? json({ paymentAuthorizationToken: "p" })
          : json({ access_token: "t" });
    await assert.rejects(uspsCreateLabel(creds, labelRequest), (e: UspsError) => !e.definitive && /puede haberse cobrado/.test(e.message));
  });

  it("la cuota (429) se explica", async () => {
    responder = (call) => (call.url.endsWith("/oauth2/v3/token") ? json({ access_token: "t" }) : call.url.endsWith("/payments/v3/payment-authorization") ? json({ paymentAuthorizationToken: "p" }) : json({}, 429));
    await assert.rejects(uspsCreateLabel(creds, labelRequest), (e: UspsError) => e.status === 429 && /cuota/.test(e.message));
  });
});

describe("multipart", () => {
  it("separa las partes por nombre y conserva los bytes", () => {
    const body = Buffer.concat([
      Buffer.from('--b\r\nContent-Disposition: form-data; name="a"\r\n\r\n{"x":1}\r\n--b\r\nContent-Disposition: form-data; name="labelImage"\r\n\r\n'),
      PDF,
      Buffer.from("\r\n--b--\r\n"),
    ]);
    const parts = parseMultipart('multipart/form-data; boundary="b"', body);
    assert.equal(parts.get("a")?.toString(), '{"x":1}');
    assert.ok(parts.get("labelImage")!.equals(PDF));
  });

  it("un PDF que no lo es se rechaza", () => {
    assert.throws(() => pdfFromPart(Buffer.from("hola mundo")), /no es un PDF/);
  });
});

describe("direcciones, anulación y rastreo", () => {
  it("devuelve la dirección como la escribe USPS y su confirmación de entrega", async () => {
    responder = (call) =>
      call.url.includes("/addresses/v3/address")
        ? json({ address: { streetAddress: "123 MAIN ST", secondaryAddress: "APT 4", city: "MIAMI", state: "FL", ZIPCode: "33101", ZIPPlus4: "1234" }, additionalInfo: { DPVConfirmation: "Y" }, corrections: [], matches: [{ code: "31", text: "Single Response - exact match" }] })
        : json({ access_token: "t" });
    const check = await uspsValidateAddress(creds, { streetAddress: "123 main st", secondaryAddress: "apt 4", city: "miami", state: "FL", ZIPCode: "33101" });
    assert.equal(check.found, true);
    assert.deepEqual(check.address, { streetAddress: "123 MAIN ST", secondaryAddress: "APT 4", city: "MIAMI", state: "FL", ZIPCode: "33101", ZIPPlus4: "1234" });
    assert.equal(check.dpvConfirmation, "Y");
    const call = calls.find((c) => c.url.includes("/addresses/v3/address"))!;
    assert.match(call.url, /^https:\/\/apis-tem\.usps\.com\/addresses\/v3\/address\?streetAddress=123\+main\+st&secondaryAddress=apt\+4&city=miami&state=FL&ZIPCode=33101$/);
  });

  it("una dirección que USPS no reconoce no es un error de conexión", async () => {
    responder = (call) => (call.url.includes("/addresses/") ? json({ error: { message: "Address Not Found." } }, 404) : json({ access_token: "t" }));
    const check = await uspsValidateAddress(creds, { streetAddress: "9 Nowhere", city: "x", state: "FL", ZIPCode: "00000" });
    assert.deepEqual(check, { found: false, address: null, dpvConfirmation: null, message: "Address Not Found." });
  });

  it("anula la etiqueta por su guía", async () => {
    responder = (call) => (call.method === "DELETE" ? json({ message: "Refund requested" }) : json({ access_token: "t" }));
    assert.deepEqual(await uspsCancelLabel(creds, "9400111899223197428490"), { message: "Refund requested" });
    const del = calls.find((c) => c.method === "DELETE")!;
    assert.equal(del.url, "https://apis-tem.usps.com/labels/v3/label/9400111899223197428490");
  });

  it("si USPS no la anula, dice por qué", async () => {
    responder = (call) => (call.method === "DELETE" ? json({ error: { message: "Label already scanned" } }, 400) : json({ access_token: "t" }));
    await assert.rejects(uspsCancelLabel(creds, "94001"), /Label already scanned/);
  });

  it("rastrea: entregado, en camino y sin escaneo todavía", async () => {
    responder = (call) => (call.url.includes("/tracking/") ? json({ status: "Delivered, Left with Individual", statusCategory: "Delivered", statusSummary: "Your item was delivered." }) : json({ access_token: "t" }));
    assert.deepEqual(await uspsTrack(creds, "94001"), { status: "Delivered, Left with Individual", statusCategory: "Delivered", summary: "Your item was delivered.", delivered: true });
    const call = calls.find((c) => c.url.includes("/tracking/"))!;
    assert.equal(call.url, "https://apis-tem.usps.com/tracking/v3/tracking/94001?expand=DETAIL");

    responder = (call) => (call.url.includes("/tracking/") ? json({ status: "In Transit", statusCategory: "In Transit" }) : json({ access_token: "t" }));
    assert.equal((await uspsTrack(creds, "94001")).delivered, false);

    responder = (call) => (call.url.includes("/tracking/") ? json({ error: { message: "Status not available" } }, 404) : json({ access_token: "t" }));
    assert.deepEqual(await uspsTrack(creds, "94001"), { status: null, statusCategory: null, summary: null, delivered: false });
  });
});
