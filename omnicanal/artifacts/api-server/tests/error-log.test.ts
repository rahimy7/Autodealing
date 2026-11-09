import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildErrorRow } = await import("../src/lib/error-log.js");

describe("lib/error-log — buildErrorRow", () => {
  it("separa el mensaje del contexto", () => {
    const row = buildErrorRow("error", [{ campaignId: 7 }, "scheduler tick failed"]);
    assert.equal(row.level, "error");
    assert.equal(row.message, "scheduler tick failed");
    assert.equal(row.detail, '{"campaignId":7}');
  });

  it("acepta un log sin contexto", () => {
    const row = buildErrorRow("error", ["algo se rompió"]);
    assert.equal(row.message, "algo se rompió");
    assert.equal(row.detail, null);
  });

  // Un Error crudo sale como `{}` de JSON.stringify, que es justo lo que hace
  // falta leer cuando algo falla.
  it("desarma los Error para que el detalle sirva de algo", () => {
    const row = buildErrorRow("error", [{ err: new Error("boom") }, "inbound ingest failed"]);
    const detail = JSON.parse(row.detail ?? "{}");
    assert.equal(detail.err.message, "boom");
    assert.equal(detail.err.name, "Error");
    assert.ok(typeof detail.err.stack === "string");
  });

  it("guarda la petición que venía del logger de la petición", () => {
    const row = buildErrorRow("error", [{ err: "x" }, "falló"], {
      req: { id: 13956, method: "POST", url: "/api/webhooks/meta" },
    });
    assert.equal(row.requestId, "13956");
    assert.equal(row.method, "POST");
    assert.equal(row.url, "/api/webhooks/meta");
  });

  it("no guarda secretos", () => {
    const row = buildErrorRow("error", [{ accessToken: "EAAG...", appSecret: "abc" }, "falló"]);
    const detail = JSON.parse(row.detail ?? "{}");
    assert.equal(detail.accessToken, "[oculto]");
    assert.equal(detail.appSecret, "[oculto]");
  });

  it("sobrevive a una referencia circular", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const row = buildErrorRow("error", [circular, "falló"]);
    assert.equal(row.message, "falló");
    assert.equal(row.detail, null);
  });

  it("recorta un detalle enorme", () => {
    const row = buildErrorRow("error", [{ body: "x".repeat(20000) }, "webhook raro"]);
    assert.ok((row.detail?.length ?? 0) <= 8001);
  });
});
