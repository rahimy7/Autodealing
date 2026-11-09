import { Router, type IRouter } from "express";
import { eq, notInArray } from "drizzle-orm";
import { db, integrationSettingsTable, whatsappNumbersTable, type WhatsappNumber } from "@workspace/db";
import {
  GetIntegrationSettingsResponse,
  UpdateIntegrationSettingsBody,
  UpdateIntegrationSettingsResponse,
  TestIntegrationBody,
  TestIntegrationResponse,
  ListWhatsappNumbersResponse,
  SaveWhatsappNumbersBody,
  SaveWhatsappNumbersResponse,
  DiscoverWhatsappNumbersResponse,
  DeleteWhatsappNumberParams,
} from "@workspace/api-zod";
import { fetchWhatsAppPhoneNumbers, graphBaseForToken, isInstagramLoginToken } from "../lib/meta";
import { listNumbers, registerNumber } from "../lib/whatsapp-numbers";

const router: IRouter = Router();

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type SettingsRow = typeof integrationSettingsTable.$inferSelect;

async function getOrCreateSettings(): Promise<SettingsRow> {
  const [existing] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(integrationSettingsTable.id)
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(integrationSettingsTable).values({}).returning();
  return created;
}

// Meta tokens very often end in the same few characters (…ZD, …ZDZD), so a
// 4-character tail alone cannot tell two different tokens apart — which makes it
// impossible to see whether a paste actually replaced the stored value. The
// length disambiguates without revealing more of the secret.
function maskPreview(value: string | null): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  const suffix = tail.length === 4 ? `••••${tail}` : "••••";
  return `${suffix} · ${value.length} car.`;
}

// Para los tokens se enseña también el principio: dice de qué tipo son (EAA… de
// Facebook, IGAA… de inicio de sesión con Instagram) sin revelar nada útil, y es lo
// que hace falta para ver de un vistazo si se pegó el token equivocado.
function tokenPreview(value: string | null): string | null {
  if (!value) return null;
  if (value.length < 12) return maskPreview(value);
  return `${value.slice(0, 4)}…${value.slice(-4)} · ${value.length} car.`;
}

function serialize(row: SettingsRow) {
  return {
    metaAppId: row.metaAppId,
    metaAppSecretSet: Boolean(row.metaAppSecret),
    metaAppSecretPreview: maskPreview(row.metaAppSecret),
    webhookVerifyToken: row.webhookVerifyToken,

    whatsappEnabled: row.whatsappEnabled,
    whatsappPhoneNumberId: row.whatsappPhoneNumberId,
    whatsappBusinessAccountId: row.whatsappBusinessAccountId,
    whatsappDisplayNumber: row.whatsappDisplayNumber,
    whatsappAccessTokenSet: Boolean(row.whatsappAccessToken),
    whatsappAccessTokenPreview: maskPreview(row.whatsappAccessToken),

    facebookEnabled: row.facebookEnabled,
    facebookPageId: row.facebookPageId,
    facebookPageAccessTokenSet: Boolean(row.facebookPageAccessToken),
    facebookPageAccessTokenPreview: tokenPreview(row.facebookPageAccessToken),

    instagramEnabled: row.instagramEnabled,
    instagramBusinessAccountId: row.instagramBusinessAccountId,
    instagramAccessTokenSet: Boolean(row.instagramAccessToken),
    instagramAccessTokenPreview: tokenPreview(row.instagramAccessToken),
    instagramAppSecretSet: Boolean(row.instagramAppSecret),
    instagramAppSecretPreview: maskPreview(row.instagramAppSecret),

    updatedAt: row.updatedAt,
  };
}

router.get("/settings/integrations", async (_req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  res.json(GetIntegrationSettingsResponse.parse(serialize(row)));
});

router.put("/settings/integrations", async (req, res): Promise<void> => {
  const parsed = UpdateIntegrationSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const row = await getOrCreateSettings();
  const body = parsed.data;
  const update: Partial<typeof integrationSettingsTable.$inferInsert> = {};

  // Plain text fields: when provided, set (empty string clears to null).
  const setText = (
    key: keyof typeof body,
    col: keyof typeof integrationSettingsTable.$inferInsert,
  ) => {
    const v = body[key];
    if (v === undefined) return;
    (update[col] as string | null) = v === null || v === "" ? null : (v as string);
  };

  // Secret fields: only overwrite when a non-empty value is provided.
  const setSecret = (
    key: keyof typeof body,
    col: keyof typeof integrationSettingsTable.$inferInsert,
  ) => {
    const v = body[key];
    if (typeof v === "string" && v.trim() !== "") {
      (update[col] as string | null) = v.trim();
    }
  };

  setText("metaAppId", "metaAppId");
  setText("webhookVerifyToken", "webhookVerifyToken");
  setSecret("metaAppSecret", "metaAppSecret");

  if (body.whatsappEnabled !== undefined) update.whatsappEnabled = body.whatsappEnabled;
  setText("whatsappPhoneNumberId", "whatsappPhoneNumberId");
  setText("whatsappBusinessAccountId", "whatsappBusinessAccountId");
  setText("whatsappDisplayNumber", "whatsappDisplayNumber");
  setSecret("whatsappAccessToken", "whatsappAccessToken");

  if (body.facebookEnabled !== undefined) update.facebookEnabled = body.facebookEnabled;
  setText("facebookPageId", "facebookPageId");
  setSecret("facebookPageAccessToken", "facebookPageAccessToken");

  if (body.instagramEnabled !== undefined) update.instagramEnabled = body.instagramEnabled;
  setText("instagramBusinessAccountId", "instagramBusinessAccountId");
  setSecret("instagramAccessToken", "instagramAccessToken");
  setSecret("instagramAppSecret", "instagramAppSecret");

  update.updatedAt = new Date();

  const [saved] = await db
    .update(integrationSettingsTable)
    .set(update)
    .where(eq(integrationSettingsTable.id, row.id))
    .returning();

  // Cambiar aquí el Phone Number ID es cambiar el número principal. Las
  // respuestas salen por la lista de números, no por este campo, así que si no se
  // lleva a la lista la bandeja sigue contestando por el número anterior.
  if (saved.whatsappPhoneNumberId && saved.whatsappPhoneNumberId !== row.whatsappPhoneNumberId) {
    await registerNumber(saved.whatsappPhoneNumberId, {
      displayNumber: saved.whatsappDisplayNumber,
      makePrimary: true,
    });
  }

  res.json(UpdateIntegrationSettingsResponse.parse(serialize(saved)));
});

// ── Los números de WhatsApp de la instancia ───────────────────────────────────
// La fila de arriba sigue guardando lo compartido (App Secret, token, WABA). Aquí
// se administra la lista de números por los que se atiende, que es lo que permite
// que la bandeja sepa por cuál entró cada conversación y responda por ese mismo.

function serializeNumber(row: WhatsappNumber) {
  return {
    id: row.id,
    phoneNumberId: row.phoneNumberId,
    displayNumber: row.displayNumber,
    verifiedName: row.verifiedName,
    label: row.label,
    isPrimary: row.isPrimary,
    isActive: row.isActive,
    // El token propio se enmascara igual que los compartidos: nunca sale del
    // servidor.
    accessTokenSet: Boolean(row.accessToken),
    accessTokenPreview: maskPreview(row.accessToken),
  };
}

router.get("/settings/whatsapp/numbers", async (_req, res): Promise<void> => {
  const numbers = await listNumbers();
  res.json(ListWhatsappNumbersResponse.parse({ numbers: numbers.map(serializeNumber) }));
});

// Le pregunta a Meta qué números tiene la WABA configurada. Solo lee: lo que el
// usuario elija se guarda después con el PUT. Así el alta no depende de copiar
// Phone Number IDs a mano, que es donde se cometen los errores.
router.post("/settings/whatsapp/numbers/discover", async (_req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  const result = await fetchWhatsAppPhoneNumbers(row);
  if (!result.ok) {
    res.json(DiscoverWhatsappNumbersResponse.parse({ ok: false, error: result.error, numbers: [] }));
    return;
  }

  const existing = new Set((await listNumbers()).map((n) => n.phoneNumberId));
  res.json(
    DiscoverWhatsappNumbersResponse.parse({
      ok: true,
      error: null,
      numbers: result.numbers.map((n) => ({ ...n, alreadyAdded: existing.has(n.phoneNumberId) })),
    }),
  );
});

router.put("/settings/whatsapp/numbers", async (req, res): Promise<void> => {
  const parsed = SaveWhatsappNumbersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Un solo principal. Gana el primero marcado; si no viene ninguno —y ya hay
  // números guardados sin principal— el respaldo de resolveOutboundNumber toma el
  // primero activo, así que la instancia nunca se queda sin por dónde salir.
  const incoming = parsed.data.numbers;
  const primaryIndex = incoming.findIndex((n) => n.isPrimary);

  for (const [index, n] of incoming.entries()) {
    const isPrimary = index === primaryIndex;
    const shared = {
      displayNumber: n.displayNumber ?? null,
      verifiedName: n.verifiedName ?? null,
      label: n.label ?? null,
      isPrimary,
      isActive: n.isActive ?? true,
      updatedAt: new Date(),
    };
    // El token solo se sobreescribe cuando llega uno de verdad, igual que los
    // secretos compartidos: un campo vacío significa "deja el que está".
    const token = typeof n.accessToken === "string" && n.accessToken.trim() !== "" ? n.accessToken.trim() : undefined;

    await db
      .insert(whatsappNumbersTable)
      .values({
        phoneNumberId: n.phoneNumberId,
        ...shared,
        ...(token ? { accessToken: token } : {}),
      })
      .onConflictDoUpdate({
        target: whatsappNumbersTable.phoneNumberId,
        set: { ...shared, ...(token ? { accessToken: token } : {}) },
      });
  }

  // Los que quedaron fuera del envío dejan de ser principales, para que no queden
  // dos marcados tras mover el principal de un número a otro.
  const keep = incoming.map((n) => n.phoneNumberId);
  if (keep.length > 0) {
    await db
      .update(whatsappNumbersTable)
      .set({ isPrimary: false })
      .where(notInArray(whatsappNumbersTable.phoneNumberId, keep));
  }

  const numbers = await listNumbers();
  res.json(SaveWhatsappNumbersResponse.parse({ numbers: numbers.map(serializeNumber) }));
});

router.delete("/settings/whatsapp/numbers/:id", async (req, res): Promise<void> => {
  const parsed = DeleteWhatsappNumberParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.delete(whatsappNumbersTable).where(eq(whatsappNumbersTable.id, Number(parsed.data.id)));
  res.sendStatus(204);
});

// ── Test a real Meta connection ───────────────────────────────────────────────
async function graphGet(
  pathAndQuery: string,
  base: string = GRAPH_BASE,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${base}/${pathAndQuery}`, { signal: controller.signal });
    let body: Record<string, unknown> = {};
    try {
      body = (await resp.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { ok: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function graphErrorMessage(body: Record<string, unknown>): string | null {
  const err = body.error as { message?: string } | undefined;
  return err?.message ?? null;
}

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asStrArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// ── Token introspection ───────────────────────────────────────────────────────
// Meta's own errors say "missing permission" without saying which token you sent,
// which turns a pasted-the-wrong-token mistake into a long guessing game. The app
// already holds the App ID and App Secret, so it can ask `debug_token` what the
// token actually is: its type, the page/user it belongs to, its scopes and expiry.
type TokenInfo = {
  type: string | null; // PAGE | USER | APP
  profileId: string | null; // page id for PAGE tokens, user id for USER tokens
  scopes: string[];
  expiresAt: number | null; // unix seconds; 0 means it never expires
  valid: boolean;
};

async function inspectToken(row: SettingsRow, token: string): Promise<TokenInfo | null> {
  // Needs an app access token, so without App ID + App Secret we simply skip the
  // extra diagnosis and fall back to Meta's raw error.
  if (!row.metaAppId || !row.metaAppSecret) return null;
  const appToken = `${row.metaAppId}|${row.metaAppSecret}`;
  const { ok, body } = await graphGet(
    `debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
  );
  if (!ok) return null;
  const data = (body.data ?? {}) as Record<string, unknown>;
  return {
    type: asStr(data.type),
    profileId: asStr(data.profile_id) ?? asStr(data.user_id),
    scopes: asStrArray(data.scopes),
    expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
    valid: data.is_valid === true,
  };
}

function describeToken(info: TokenInfo | null): string {
  if (!info) return "";
  const bits = [`tipo ${info.type ?? "desconocido"}`];
  if (info.expiresAt === 0) bits.push("no expira");
  else if (info.expiresAt)
    bits.push(`expira el ${new Date(info.expiresAt * 1000).toISOString().slice(0, 10)}`);
  return ` · Token: ${bits.join(", ")}.`;
}

// Empty when the token's scopes are unknown (debug_token unavailable), so a
// missing-scope hint is only shown when it is actually backed by data.
function missingScopes(info: TokenInfo | null, required: string[]): string[] {
  if (!info || info.scopes.length === 0) return [];
  return required.filter((scope) => !info.scopes.includes(scope));
}

function permissionHint(info: TokenInfo | null, required: string[], expectedType: string): string {
  const missing = missingScopes(info, required);
  if (missing.length > 0) return ` Al token le faltan estos permisos: ${missing.join(", ")}.`;
  if (info && info.type && info.type !== expectedType)
    return ` El token es de tipo ${info.type}, se esperaba ${expectedType}.`;
  return "";
}

// Meta firma el webhook con el App Secret de la app SUSCRITA a la WABA, que no
// tiene por qué ser la app cuyo App ID/Secret están guardados aquí (una cuenta
// de negocio suele tener varias apps, y el secret se copia de la pestaña que
// esté abierta). Cuando no coinciden, el envío funciona pero cada webhook
// entrante se rechaza con 403 por firma inválida, así que el test lo dice.
async function subscribedAppMismatch(row: SettingsRow, token: string): Promise<string> {
  if (!row.whatsappBusinessAccountId || !row.metaAppId) return "";
  const { ok, body } = await graphGet(
    `${row.whatsappBusinessAccountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
  );
  if (!ok) return "";
  const entries = Array.isArray(body.data) ? body.data : [];
  const apps = entries
    .map((e) => (e as Record<string, unknown>).whatsapp_business_api_data)
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object");
  if (apps.length === 0) {
    return " Aviso: ninguna app está suscrita a esta WABA, así que no llegarán webhooks.";
  }
  if (apps.some((d) => asStr(d.id) === row.metaAppId)) return "";
  const names = apps
    .map((d) => `${asStr(d.name) ?? "sin nombre"} (App ID ${asStr(d.id) ?? "?"})`)
    .join(", ");
  return (
    ` Aviso: los webhooks de esta WABA los envía ${names}, no la app ${row.metaAppId}` +
    ` que está configurada aquí. El App Secret debe ser el de esa app, o el webhook` +
    ` se rechazará con firma inválida.`
  );
}

router.post("/settings/integrations/test", async (req, res): Promise<void> => {
  const parsed = TestIntegrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { channel } = parsed.data;
  const row = await getOrCreateSettings();

  const fail = (message: string, details: string | null = null) =>
    res.json(TestIntegrationResponse.parse({ ok: false, channel, message, details }));
  const success = (message: string, details: string | null = null) =>
    res.json(TestIntegrationResponse.parse({ ok: true, channel, message, details }));

  try {
    if (channel === "whatsapp") {
      if (!row.whatsappPhoneNumberId || !row.whatsappAccessToken) {
        fail("Faltan el Phone Number ID y/o el Access Token de WhatsApp.");
        return;
      }
      // El número es la prueba funcional. debug_token y subscribed_apps son
      // diagnósticos opcionales: otra app puede emitir el token de WhatsApp y
      // una demora en esas consultas no debe invalidar una conexión que funciona.
      const q = `${row.whatsappPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating&access_token=${encodeURIComponent(row.whatsappAccessToken)}`;
      const { ok, body } = await graphGet(q);
      const [info, mismatch] = await Promise.all([
        inspectToken(row, row.whatsappAccessToken).catch(() => null),
        ok
          ? subscribedAppMismatch(row, row.whatsappAccessToken).catch(
              () => " No se pudo comprobar la suscripción del webhook; revisa los mensajes entrantes.",
            )
          : Promise.resolve(""),
      ]);
      if (!ok) {
        const hint = missingScopes(info, ["whatsapp_business_messaging"]).length
          ? " Al token le falta el permiso whatsapp_business_messaging."
          : "";
        fail(
          (graphErrorMessage(body) ?? "Meta rechazó la conexión de WhatsApp.") + hint + describeToken(info),
          JSON.stringify(body.error ?? body),
        );
        return;
      }
      const name = (body.verified_name as string) ?? "—";
      const number = (body.display_phone_number as string) ?? row.whatsappPhoneNumberId;
      success(
        `Conexión válida: ${name} (${number}).` + describeToken(info) + mismatch,
        JSON.stringify(body),
      );
      return;
    }

    if (channel === "facebook") {
      if (!row.facebookPageId || !row.facebookPageAccessToken) {
        fail("Faltan el Page ID y/o el Page Access Token de Facebook.");
        return;
      }
      const token = row.facebookPageAccessToken;
      const info = await inspectToken(row, token);

      // Identity comes from debug_token: `profile_id` is the page the token was
      // minted for, and reading it costs no page permission. Resolving identity
      // with a Graph call on the page instead would require
      // pages_read_engagement — which messaging does NOT need, so gating on it
      // reports a broken connection while the inbox works fine.
      if (info && info.type && info.type !== "PAGE") {
        // A system user token is the right *origin* for a permanent page token but
        // cannot be used directly: /me/messages needs /me to resolve to the page.
        // Deriving the page token from it is one call, so name that call instead of
        // sending the admin back to generate a different token from scratch.
        const howTo =
          info.type === "SYSTEM_USER"
            ? "Es el token del usuario del sistema, no el de la página. Pide el de la página con GET /me/accounts?fields=name,access_token usando este mismo token: el que devuelve hereda su carácter permanente."
            : "Genéralo en Messenger → Configuración de la API de Messenger, o con GET /me/accounts?fields=name,access_token.";
        fail(`El token es de tipo ${info.type}; hace falta un Page Access Token. ${howTo}` + describeToken(info));
        return;
      }
      if (info?.profileId && info.profileId !== row.facebookPageId) {
        fail(
          `El token pertenece a la página ${info.profileId}, pero el Page ID guardado es ${row.facebookPageId}.` +
            describeToken(info),
        );
        return;
      }

      // Functional check on pages_messaging alone — the only permission the
      // inbox depends on.
      const { ok, body } = await graphGet(
        `me/messaging_feature_review?access_token=${encodeURIComponent(token)}`,
      );
      if (!ok) {
        fail(
          (graphErrorMessage(body) ?? "Meta rechazó la conexión de Facebook.") +
            permissionHint(info, ["pages_messaging"], "PAGE") +
            describeToken(info),
          JSON.stringify(body.error ?? body),
        );
        return;
      }

      // Everything below is best-effort context: a missing permission here does
      // not stop messages from flowing, so it is reported as a note, never as a
      // failed connection.
      const pageInfo = await graphGet(
        `${row.facebookPageId}?fields=name&access_token=${encodeURIComponent(token)}`,
      );
      const pageName = pageInfo.ok ? asStr(pageInfo.body.name) : null;

      const subs = await graphGet(
        `${row.facebookPageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
      );
      const apps = Array.isArray(subs.body.data) ? (subs.body.data as Record<string, unknown>[]) : [];
      const mine = apps.find((a) => asStr(a.id) === row.metaAppId) ?? apps[0];
      const fields = mine ? asStrArray(mine.subscribed_fields) : [];
      const webhookNote = !subs.ok
        ? " La suscripción del webhook no se puede verificar desde aquí (el token no tiene pages_manage_metadata); revísala en Messenger → Configuración de la API."
        : fields.length === 0
          ? " ⚠ La página NO está suscrita a la app: no van a llegar mensajes. Suscríbela en Messenger → Configuración de la API de Messenger."
          : fields.includes("messages")
            ? ` Webhook suscrito a: ${fields.join(", ")}.`
            : ` ⚠ La página está suscrita (${fields.join(", ")}) pero falta el campo "messages".`;

      // Only the Feed module needs these; say so instead of implying the
      // connection is broken.
      const feedMissing = missingScopes(info, ["pages_read_engagement", "pages_manage_engagement"]);
      const feedNote =
        feedMissing.length > 0
          ? ` El módulo Feed (comentarios) necesita además: ${feedMissing.join(", ")}.`
          : "";

      success(
        `Mensajería activa en ${pageName ?? `la página ${row.facebookPageId}`}.` +
          webhookNote +
          feedNote +
          describeToken(info),
        JSON.stringify({ page: pageInfo.body, subscribedApps: subs.body }),
      );
      return;
    }

    // instagram
    const igToken = row.instagramAccessToken || row.facebookPageAccessToken;
    if (!row.instagramBusinessAccountId || !igToken) {
      fail("Faltan el Instagram Business Account ID y/o un Access Token válido.");
      return;
    }
    // Both channels ask for an "ID", so the Facebook Page ID lands in this field
    // often. Querying it would fail with a permissions error about pages_*, which
    // sends you hunting for the wrong problem.
    if (row.instagramBusinessAccountId === row.facebookPageId) {
      fail(
        `Ese es el Page ID de Facebook, no el Instagram Business Account ID (empieza con 1784…). Obtenlo en el Explorador de la API Graph con: GET /me/accounts?fields=name,instagram_business_account`,
      );
      return;
    }
    // Token de "inicio de sesión con Instagram" (IGAA…): vive en graph.instagram.com
    // y debug_token, que va con el App ID/Secret de Facebook, no lo reconoce. La
    // cuenta y la suscripción del webhook se leen con el propio token.
    if (isInstagramLoginToken(igToken)) {
      const igBase = graphBaseForToken(igToken);
      const me = await graphGet(
        `me?fields=user_id,username,name,followers_count&access_token=${encodeURIComponent(igToken)}`,
        igBase,
      );
      if (!me.ok) {
        fail(
          (graphErrorMessage(me.body) ?? "Meta rechazó el token de Instagram.") +
            " Estos tokens duran 60 días: si caducó, genera uno nuevo en la configuración de la API con inicio de sesión de Instagram.",
          JSON.stringify(me.body.error ?? me.body),
        );
        return;
      }
      const username = asStr(me.body.username);
      const accountId = asStr(me.body.user_id);
      if (accountId && accountId !== row.instagramBusinessAccountId) {
        fail(
          `El token es de la cuenta ${accountId} (@${username ?? "?"}), pero el Instagram Business Account ID guardado es ${row.instagramBusinessAccountId}.`,
        );
        return;
      }
      const subs = await graphGet(
        `me/subscribed_apps?access_token=${encodeURIComponent(igToken)}`,
        igBase,
      );
      const apps = Array.isArray(subs.body.data) ? (subs.body.data as Record<string, unknown>[]) : [];
      const fields = apps.flatMap((a) => asStrArray(a.subscribed_fields));
      const webhookNote = !subs.ok
        ? " No se pudo verificar la suscripción del webhook."
        : fields.includes("messages")
          ? ` Webhook suscrito a: ${fields.join(", ")}.`
          : " ⚠ La cuenta NO está suscrita al webhook de mensajes: no van a llegar DMs. Actívalo en «Suscripción al webhook», junto al token.";
      success(
        `Cuenta conectada: @${username ?? accountId ?? row.instagramBusinessAccountId}.` +
          webhookNote +
          " Token de inicio de sesión con Instagram (dura 60 días).",
        JSON.stringify({ account: me.body, subscribedApps: subs.body }),
      );
      return;
    }

    // Which token was used matters when diagnosing: the Instagram field is
    // optional and falls back to the Facebook page token.
    const tokenOrigin = row.instagramAccessToken
      ? ""
      : " (usando el Page Access Token de Facebook)";
    const info = await inspectToken(row, igToken);
    const q = `${row.instagramBusinessAccountId}?fields=username,name,followers_count&access_token=${encodeURIComponent(igToken)}`;
    const { ok, body } = await graphGet(q);
    if (!ok) {
      // This lookup needs instagram_basic. Its absence does not by itself stop
      // DMs (those ride on instagram_manage_messages), so the hint separates the
      // two instead of declaring the channel dead.
      const dmScope = missingScopes(info, ["instagram_manage_messages"]);
      const hint =
        missingScopes(info, ["instagram_basic"]).length > 0
          ? ` Al token le falta instagram_basic, necesario para leer los datos de la cuenta.${
              dmScope.length > 0
                ? " También le falta instagram_manage_messages, sin el cual no llegan los DMs."
                : " Los DMs pueden funcionar igual: instagram_manage_messages sí está presente."
            }`
          : permissionHint(info, ["instagram_manage_messages"], "PAGE");
      fail(
        (graphErrorMessage(body) ?? "Meta rechazó la conexión de Instagram.") +
          hint +
          tokenOrigin +
          ` El token guardado empieza con «${igToken.slice(0, 4)}…»: el de inicio de sesión con Instagram empieza con IGAA y el de página con EAA.` +
          describeToken(info),
        JSON.stringify(body.error ?? body),
      );
      return;
    }
    success(
      `Cuenta conectada: @${asStr(body.username) ?? row.instagramBusinessAccountId}.` +
        tokenOrigin +
        describeToken(info),
      JSON.stringify(body),
    );
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? "Tiempo de espera agotado al contactar a Meta."
      : "No se pudo contactar a la Graph API de Meta.";
    res.json(TestIntegrationResponse.parse({ ok: false, channel, message: msg, details: String(err) }));
  }
});

export default router;
