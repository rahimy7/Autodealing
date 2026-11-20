import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { VIEW_KEYS, VIEWS, type ViewKey } from "@workspace/platform-config";

const { navEntries } = await import("../src/lib/nav.js");
const { siteLoginOnly } = await import("../src/lib/auth.js");

describe("menú del panel para quien lo incruste", () => {
  it("lista las vistas del usuario, en el orden del catálogo", () => {
    const views = new Set<ViewKey>(["reports", "inbox", "contacts"]);
    const entries = navEntries(views, () => true);
    assert.deepEqual(
      entries.map((e) => e.key),
      VIEW_KEYS.filter((k) => views.has(k)),
    );
    assert.deepEqual(entries[0], { key: "inbox", label: VIEWS.inbox.label, path: "/inbox", group: "operations" });
  });

  it("deja fuera lo que el usuario no tiene, aunque la instancia lo tenga", () => {
    const entries = navEntries(new Set<ViewKey>(["inbox"]), () => true);
    assert.deepEqual(entries.map((e) => e.key), ["inbox"]);
  });

  it("deja fuera las vistas cuyo módulo la instancia no tiene encendido", () => {
    const views = new Set<ViewKey>(["inbox", "campaigns", "settings"]);
    const entries = navEntries(views, (module) => module !== "marketing");
    // Configuración no pide módulo; Marketing sí, y está apagado.
    assert.deepEqual(entries.map((e) => e.key), ["inbox", "settings"]);
  });

  it("sin vistas no hay menú", () => {
    assert.deepEqual(navEntries(new Set(), () => true), []);
  });
});

describe("entrar solo con la cuenta del sitio", () => {
  const before = process.env.SITE_LOGIN_ONLY;
  afterEach(() => {
    if (before === undefined) delete process.env.SITE_LOGIN_ONLY;
    else process.env.SITE_LOGIN_ONLY = before;
  });

  it("solo con SITE_LOGIN_ONLY=1", () => {
    delete process.env.SITE_LOGIN_ONLY;
    assert.equal(siteLoginOnly(), false);
    process.env.SITE_LOGIN_ONLY = "1";
    assert.equal(siteLoginOnly(), true);
    process.env.SITE_LOGIN_ONLY = "true";
    assert.equal(siteLoginOnly(), false, "un valor distinto de 1 no lo enciende");
  });
});
