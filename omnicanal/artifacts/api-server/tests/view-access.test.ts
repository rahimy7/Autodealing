import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VIEW_KEYS,
  VIEWS,
  VIEW_GROUPS,
  MODULE_KEYS,
  DEFAULT_VIEWS_BY_ROLE,
  defaultViewsForRole,
  homeViewFor,
  isViewKey,
} from "@workspace/platform-config";
import { VIEW_GATES, viewsForPath, hasAnyView, ENV_ADMIN_VIEWS } from "../src/lib/view-gates";

describe("catálogo de vistas", () => {
  it("cada vista tiene grupo, ruta única y, si lo declara, un módulo que existe", () => {
    const paths = new Set<string>();
    for (const key of VIEW_KEYS) {
      const view = VIEWS[key];
      assert.ok(view.label && view.description, `a ${key} le falta el texto`);
      assert.ok((VIEW_GROUPS as readonly string[]).includes(view.group), `${key}: grupo desconocido`);
      assert.ok(!paths.has(view.path), `la ruta ${view.path} la usan dos vistas`);
      paths.add(view.path);
      if (view.module) assert.ok((MODULE_KEYS as readonly string[]).includes(view.module), `${key}: módulo ${view.module}`);
    }
  });

  it("cada vista tiene su ruta en el panel web", () => {
    // Si se agrega una vista y no su <Route>, la vista se asignaría y llevaría a un 404.
    const app = readFileSync(fileURLToPath(new URL("../../omnicanal/src/App.tsx", import.meta.url)), "utf8");
    for (const key of VIEW_KEYS) {
      const { path } = VIEWS[key];
      // El dashboard cuelga de "/" (HomeRedirect) y el portal tiene su propia ruta sin sesión.
      assert.ok(app.includes(`path="${path}"`), `App.tsx no tiene <Route path="${path}"> para ${key}`);
    }
  });

  it("isViewKey reconoce las claves y rechaza el resto", () => {
    assert.equal(isViewKey("orders"), true);
    assert.equal(isViewKey("pedidos"), false);
    assert.equal(isViewKey(42), false);
  });
});

describe("acceso por defecto de cada rol", () => {
  it("el administrador conserva todo el panel y el agente solo atiende", () => {
    const admin = defaultViewsForRole("admin");
    const agent = defaultViewsForRole("agent");
    assert.deepEqual(agent, ["my-chats", "general-chat", "my-profile"]);
    // Lo que el administrador veía antes: cada pantalla del panel menos las del agente.
    assert.deepEqual(
      admin,
      VIEW_KEYS.filter((key) => !agent.includes(key)),
    );
    assert.ok(admin.includes("dashboard") && admin.includes("admin") && admin.includes("orders"));
  });

  it("devuelve una copia: quien la modifique no cambia el catálogo", () => {
    const copy = defaultViewsForRole("agent");
    copy.push("orders");
    assert.equal(DEFAULT_VIEWS_BY_ROLE.agent.includes("orders"), false);
  });
});

describe("homeViewFor", () => {
  it("el administrador aterriza en el dashboard y el agente en el Chat General", () => {
    assert.equal(homeViewFor(defaultViewsForRole("admin")), "dashboard");
    assert.equal(homeViewFor(defaultViewsForRole("agent")), "general-chat");
  });

  it("sin dashboard cae en la primera vista que tenga, por el orden del menú", () => {
    assert.equal(homeViewFor(["reports", "orders"]), "orders");
  });

  it("ignora las vistas cuyo módulo la instancia no tiene", () => {
    const off = (module: string) => module !== "orders";
    assert.equal(homeViewFor(["orders", "cases"], off), "cases");
    assert.equal(homeViewFor(["orders"], off), null);
  });

  it("sin ninguna vista no hay a dónde ir", () => {
    assert.equal(homeViewFor([]), null);
  });
});

describe("candados del servidor (VIEW_GATES)", () => {
  it("cada regla apunta a vistas que existen y no está repetida", () => {
    const seen = new Set<string>();
    for (const [prefix, views] of VIEW_GATES) {
      assert.ok(prefix.startsWith("/"), prefix);
      assert.ok(!seen.has(prefix), `el prefijo ${prefix} está dos veces`);
      seen.add(prefix);
      assert.ok(views.length > 0, `${prefix} no abre ninguna vista`);
      for (const view of views) assert.ok(VIEW_KEYS.includes(view), `${prefix}: la vista ${view} no existe`);
    }
  });

  it("gana el prefijo más largo", () => {
    assert.deepEqual(viewsForPath("/settings"), ["settings"]);
    assert.deepEqual(viewsForPath("/settings/shopify"), ["settings"]);
    // Las credenciales de USPS son de Configuración; comprar etiquetas, de quien despacha.
    assert.deepEqual(viewsForPath("/settings/usps"), ["settings"]);
    assert.deepEqual(viewsForPath("/usps/labels/4/void"), ["shipments", "orders"]);
    assert.deepEqual(viewsForPath("/shopify-labels/draft"), ["shipments", "orders"]);
    assert.deepEqual(viewsForPath("/settings/whatsapp/numbers/3"), ["settings", "inbox", "campaigns"]);
    assert.equal(viewsForPath("/products"), null);
    assert.deepEqual(viewsForPath("/products/manage"), ["products", "inventory"]);
  });

  it("el prefijo tiene que coincidir entero", () => {
    assert.equal(viewsForPath("/contactsX"), null);
    assert.equal(viewsForPath("/inventory-report"), null);
  });

  it("el administrador de entorno ve todo el panel, menos las vistas que piden un agente detrás", () => {
    assert.deepEqual([...ENV_ADMIN_VIEWS], [...defaultViewsForRole("admin")]);
    assert.equal(hasAnyView(ENV_ADMIN_VIEWS, ["logs"]), true);
    assert.equal(hasAnyView(ENV_ADMIN_VIEWS, ["my-chats"]), false);
    assert.equal(hasAnyView(undefined, ["logs"]), false);
  });

  it("toda vista que algún endpoint exige la tiene el administrador de entorno", () => {
    // Si no, esa parte del panel quedaría cerrada para la cuenta que no se puede restringir.
    for (const [prefix, views] of VIEW_GATES) {
      assert.ok(views.some((view) => ENV_ADMIN_VIEWS.has(view)), `${prefix} no lo abre el administrador de entorno`);
    }
  });
});
