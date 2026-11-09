// El sitio web de Premier (server/omnicanal.js, en la raíz de este proyecto) le
// habla a esta instancia firmando sesiones cortas con el mismo SESSION_SECRET: así
// cada vendedor atiende como su propio agente. Esta prueba usa el verifyToken real
// de esta copia contra los tokens que firma el sitio; si el formato cambia de un
// lado, falla aquí y no en producción.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SECRET = "premier-site-" + "x".repeat(24);
process.env.SESSION_SECRET = SECRET;

const { verifyToken } = await import("../src/lib/auth.js");
// Ruta en variable: es JavaScript del sitio, fuera de este workspace de TypeScript.
const sitePath = new URL("../../../../server/omnicanal.js", import.meta.url).href;
const site = (await import(sitePath)) as {
  mintToken: (secret: string, identity: Record<string, unknown>, ttl?: number, now?: number) => string;
};

describe("sesiones firmadas por el sitio de Premier", () => {
  it("un vendedor vinculado entra como su agente", () => {
    const token = site.mintToken(SECRET, { role: "agent", name: "Ana Ventas", email: "ana@premier.test", agentId: 7 });
    assert.deepEqual(verifyToken(token), { role: "agent", name: "Ana Ventas", email: "ana@premier.test", agentId: 7 });
  });

  it("la identidad del sistema entra como administrador de entorno, sin fila de agente", () => {
    const user = verifyToken(site.mintToken(SECRET, { role: "admin", name: "Premier · sistema", email: "integracion@sitio-web" }));
    assert.equal(user?.role, "admin");
    assert.equal(user?.agentId, null);
  });

  it("no acepta un token vencido ni uno firmado con otro secreto", () => {
    const old = site.mintToken(SECRET, { role: "agent", name: "A", agentId: 1 }, 300, Date.now() - 301_000);
    assert.equal(verifyToken(old), null);
    assert.equal(verifyToken(site.mintToken("otro-secreto-de-prueba-000", { role: "agent", name: "A", agentId: 1 })), null);
  });
});
