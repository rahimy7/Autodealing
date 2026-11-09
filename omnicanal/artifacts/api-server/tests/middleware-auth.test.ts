import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod";
process.env.NODE_ENV = "test";

const { signToken } = await import("../src/lib/auth.js");
const { requireAuth, requireView, viewGatedPaths } = await import(
  "../src/middlewares/auth.js"
);

type NextCall = { called: boolean; err?: unknown };

function mockReq(overrides: Partial<{
  headers: Record<string, string>;
  path: string;
  user: { role: "admin" | "agent"; name: string; email: string; agentId: number | null };
  views: string[];
}> = {}) {
  const headers: Record<string, string> = overrides.headers ?? {};
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    path: overrides.path ?? "/",
    user: overrides.user,
    views: overrides.views ? new Set(overrides.views) : undefined,
  } as unknown as Parameters<typeof requireAuth>[0];
}

function mockRes() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Parameters<typeof requireAuth>[1], state };
}

function mockNext(): (err?: unknown) => void {
  const call: NextCall = { called: false };
  const fn = (err?: unknown) => {
    call.called = true;
    call.err = err;
  };
  (fn as unknown as { call: NextCall }).call = call;
  return fn;
}

function callState(next: ReturnType<typeof mockNext>): NextCall {
  return (next as unknown as { call: NextCall }).call;
}

describe("middleware — requireAuth", () => {
  it("responds 401 when Authorization header is missing", () => {
    const req = mockReq();
    const { res, state } = mockRes();
    const next = mockNext();
    requireAuth(req, res, next);
    assert.equal(state.status, 401);
    assert.deepEqual(state.body, { error: "No autenticado." });
    assert.equal(callState(next).called, false);
  });

  it("responds 401 with a malformed bearer", () => {
    const req = mockReq({ headers: { authorization: "Basic abcd" } });
    const { res, state } = mockRes();
    const next = mockNext();
    requireAuth(req, res, next);
    assert.equal(state.status, 401);
    assert.equal(callState(next).called, false);
  });

  it("responds 401 with an invalid token", () => {
    const req = mockReq({ headers: { authorization: "Bearer not-a-real-token" } });
    const { res, state } = mockRes();
    const next = mockNext();
    requireAuth(req, res, next);
    assert.equal(state.status, 401);
    assert.equal(callState(next).called, false);
  });

  it("calls next() and populates req.user with a valid token", () => {
    const token = signToken({
      role: "agent",
      name: "Bob",
      email: "bob@example.com",
      agentId: 7,
    });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const { res, state } = mockRes();
    const next = mockNext();
    requireAuth(req, res, next);
    assert.equal(state.status, undefined);
    assert.equal(callState(next).called, true);
    assert.equal((req as { user?: { email: string } }).user?.email, "bob@example.com");
  });
});

describe("middleware — requireView", () => {
  const agent = { role: "agent" as const, name: "B", email: "b@e.com", agentId: 1 };
  const admin = { role: "admin" as const, name: "A", email: "a@e.com", agentId: 2 };

  it("responds 403 to a user who does not own the view", () => {
    const req = mockReq({ user: agent, views: ["my-chats"] });
    const { res, state } = mockRes();
    const next = mockNext();
    requireView("feed")(req, res, next);
    assert.equal(state.status, 403);
    assert.deepEqual(state.body, { error: "Tu usuario no tiene acceso a esta vista." });
    assert.equal(callState(next).called, false);
  });

  it("lets through a user who owns any of the views, whatever their role", () => {
    const req = mockReq({ user: agent, views: ["inventory"] });
    const { res, state } = mockRes();
    const next = mockNext();
    requireView("products", "inventory")(req, res, next);
    assert.equal(state.status, undefined);
    assert.equal(callState(next).called, true);
  });

  it("does not trust the role: an admin without the view is turned away", () => {
    const req = mockReq({ user: admin, views: ["dashboard"] });
    const { res, state } = mockRes();
    const next = mockNext();
    requireView("feed")(req, res, next);
    assert.equal(state.status, 403);
    assert.equal(callState(next).called, false);
  });

  it("closes the door when the views were never loaded", () => {
    const req = mockReq({ user: admin });
    const { res, state } = mockRes();
    const next = mockNext();
    requireView("feed")(req, res, next);
    assert.equal(state.status, 403);
  });
});

describe("middleware — viewGatedPaths", () => {
  const agent = { role: "agent" as const, name: "B", email: "b@e.com", agentId: 1 };
  const admin = { role: "admin" as const, name: "A", email: "a@e.com", agentId: 2 };

  // Lo que antes era "solo administrador": un agente de servicio (sus tres vistas
  // de atención) tiene que seguir viéndolo cerrado.
  const gatedPaths = [
    "/contacts",
    "/contacts/42",
    "/contact-facts/9",
    "/campaigns",
    "/labels",
    "/workflows",
    "/knowledge-bases",
    "/groups",
    "/capabilities",
    "/plan",
    "/analytics",
    "/settings",
    "/feed",
    "/email",
    "/custom-messages",
    "/logs",
    "/agent-lessons",
    "/warehouses",
    "/inventory",
    "/shipments",
    "/carriers",
    "/usps/draft",
    "/usps/labels",
    "/shopify-labels",
    "/settings/usps",
    "/products/manage",
    "/suppliers",
    "/purchasing",
    "/returns",
    "/credit-notes",
    "/view-access",
  ];

  for (const path of gatedPaths) {
    it(`keeps "${path}" closed to a service agent`, () => {
      const req = mockReq({ path, user: agent, views: ["my-chats", "general-chat", "my-profile"] });
      const { res, state } = mockRes();
      const next = mockNext();
      viewGatedPaths(req, res, next);
      assert.equal(state.status, 403, `expected 403 on ${path}`);
      assert.equal(callState(next).called, false);
    });
  }

  const run = (path: string, user: typeof agent | typeof admin, views: string[]) => {
    const req = mockReq({ path, user, views });
    const { res, state } = mockRes();
    const next = mockNext();
    viewGatedPaths(req, res, next);
    return { status: state.status, passed: callState(next).called };
  };

  it("opens a gated path to an agent-role user who was given the view", () => {
    assert.deepEqual(run("/returns", agent, ["orders"]), { status: undefined, passed: true });
    assert.deepEqual(run("/feed/threads", agent, ["feed"]), { status: undefined, passed: true });
  });

  it("closes a gated path to an admin-role user who does not have the view", () => {
    assert.equal(run("/settings", admin, ["dashboard", "orders"]).status, 403);
    assert.equal(run("/logs", admin, ["dashboard"]).status, 403);
  });

  it("lets any view that uses a shared endpoint reach it", () => {
    // Pedidos y Casos consultan los contactos sin tener la vista Contactos.
    assert.equal(run("/contacts", admin, ["orders"]).passed, true);
    assert.equal(run("/contacts", admin, ["cases"]).passed, true);
    assert.equal(run("/contacts", admin, ["reports"]).passed, false);
  });

  it("keeps the credentials of Configuración apart from the pickers other views share", () => {
    // La Bandeja elige el número de WhatsApp, pero no toca las demás credenciales.
    assert.equal(run("/settings/whatsapp/numbers", admin, ["inbox"]).passed, true);
    assert.equal(run("/settings/gmail", admin, ["email"]).passed, true);
    assert.equal(run("/settings/integrations", admin, ["inbox"]).status, 403);
    assert.equal(run("/settings/shopify", admin, ["inbox", "email"]).status, 403);
    assert.equal(run("/settings/usps", admin, ["shipments", "orders"]).status, 403);
    // Comprar la etiqueta es de quien arma los despachos, no de quien solo atiende chats.
    assert.equal(run("/usps/labels", admin, ["shipments"]).passed, true);
    assert.equal(run("/usps/labels", admin, ["inbox"]).status, 403);
    assert.equal(run("/shopify-labels", admin, ["orders"]).passed, true);
    assert.equal(run("/shopify-labels", admin, ["inbox"]).status, 403);
  });

  it("only the Administración view can read or change who sees what", () => {
    assert.equal(run("/view-access/5", admin, ["settings", "agents"]).status, 403);
    assert.equal(run("/view-access/5", agent, ["admin"]).passed, true);
  });

  it("splits the product catalog: reading is open, managing it is not", () => {
    assert.equal(run("/products", agent, ["general-chat"]).passed, true);
    assert.equal(run("/products/manage/3", agent, ["general-chat"]).status, 403);
    assert.equal(run("/products/manage/3", agent, ["products"]).passed, true);
  });

  it('passes through non-gated paths (e.g. "/conversations") for any signed-in user', () => {
    assert.deepEqual(run("/conversations", agent, ["my-chats"]), { status: undefined, passed: true });
  });

  it("does not match prefix collisions (e.g. /contactsX is NOT gated)", () => {
    assert.deepEqual(run("/contactsX", agent, ["my-chats"]), { status: undefined, passed: true });
  });
});
