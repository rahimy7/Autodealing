import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import { verifyPayload } from "../lib/auth";
import * as gmail from "../lib/gmail";
import { loadGmailSettings, syncGmail } from "../lib/email";

// A esta ruta vuelve el navegador desde la pantalla de permisos de Google. Es
// pública porque la redirección no lleva la sesión del panel: la autoriza el
// `state`, que firmó el servidor al pedir la URL desde una sesión de administrador
// y que caduca en 15 minutos.

export const GMAIL_OAUTH_PURPOSE = "gmail-oauth";
export const GMAIL_OAUTH_CALLBACK_PATH = "/gmail/oauth/callback";

const router: IRouter = Router();

function backTo(returnUrl: string, outcome: "connected" | "error", reason?: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("tab", "email");
  url.searchParams.set("gmail", outcome);
  if (reason) url.searchParams.set("reason", reason.slice(0, 300));
  return url.toString();
}

router.get(GMAIL_OAUTH_CALLBACK_PATH, async (req, res): Promise<void> => {
  const state = typeof req.query.state === "string" ? verifyPayload(GMAIL_OAUTH_PURPOSE, req.query.state) : null;
  const redirectUri = typeof state?.redirectUri === "string" ? state.redirectUri : null;
  const returnUrl = typeof state?.returnUrl === "string" ? state.returnUrl : null;
  if (!redirectUri || !returnUrl) {
    res
      .status(400)
      .type("text/plain; charset=utf-8")
      .send("El enlace de autorización no es válido o caducó. Vuelve a Configuración → Correo y pulsa Conectar otra vez.");
    return;
  }

  // Quien pulsó "Cancelar" en Google vuelve con `error=access_denied`.
  if (typeof req.query.error === "string") {
    const reason = req.query.error === "access_denied" ? "No se concedió el acceso a Gmail." : `Google: ${req.query.error}`;
    res.redirect(backTo(returnUrl, "error", reason));
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const settings = await loadGmailSettings();
  if (!code || !settings?.gmailClientId || !settings.gmailClientSecret) {
    res.redirect(backTo(returnUrl, "error", "Faltan el Client ID o el Client Secret."));
    return;
  }

  const exchanged = await gmail.exchangeAuthCode({
    clientId: settings.gmailClientId,
    clientSecret: settings.gmailClientSecret,
    redirectUri,
    code,
  });
  if (!exchanged.ok) {
    req.log.warn({ error: exchanged.error }, "gmail oauth exchange failed");
    res.redirect(backTo(returnUrl, "error", exchanged.error));
    return;
  }
  if (!exchanged.data.refreshToken) {
    res.redirect(
      backTo(returnUrl, "error", "Google no entregó acceso permanente. Quita la app en myaccount.google.com/permissions y conecta de nuevo."),
    );
    return;
  }

  const creds = {
    clientId: settings.gmailClientId,
    clientSecret: settings.gmailClientSecret,
    refreshToken: exchanged.data.refreshToken,
  };
  const profile = await gmail.getProfile(creds);
  if (!profile.ok) {
    res.redirect(backTo(returnUrl, "error", profile.error));
    return;
  }

  // Otra cuenta distinta de la que estaba empieza con su propia importación. La
  // misma cuenta reconectada sigue donde iba.
  const sameAccount = settings.gmailEmailAddress?.toLowerCase() === profile.data.emailAddress.toLowerCase();
  await db
    .update(integrationSettingsTable)
    .set({
      gmailRefreshToken: exchanged.data.refreshToken,
      gmailEmailAddress: profile.data.emailAddress.toLowerCase(),
      gmailEnabled: true,
      gmailLastError: null,
      ...(sameAccount ? {} : { gmailHistoryId: null }),
      updatedAt: new Date(),
    })
    .where(eq(integrationSettingsTable.id, settings.id));
  req.log.info({ emailAddress: profile.data.emailAddress }, "gmail connected");

  // La importación inicial arranca ya, sin esperar al siguiente ciclo del scheduler.
  void syncGmail(req.log);
  res.redirect(backTo(returnUrl, "connected"));
});

export default router;
