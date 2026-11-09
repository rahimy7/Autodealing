import { Router, type IRouter } from "express";
import { RegisterDeviceBody, UnregisterDeviceBody, RegisterDeviceResponse, UnregisterDeviceResponse, SendTestPushResponse } from "@workspace/api-zod";
import { registerDevice, unregisterDevice, devicesForUser, sendPush, isValidDeviceToken, pushProviderStatus } from "../lib/push";

const router: IRouter = Router();

router.post("/push/devices", async (req, res): Promise<void> => {
  const parsed = RegisterDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const token = parsed.data.token.trim();
  const platform = parsed.data.platform ?? "android";
  if (!isValidDeviceToken(token, platform)) {
    res.status(400).json({ error: "Token de notificaciones inválido." });
    return;
  }

  await registerDevice({
    token,
    platform,
    deviceName: parsed.data.deviceName ?? null,
    agentId: req.user?.agentId ?? null,
    userEmail: req.user!.email,
    role: req.user!.role,
  });

  req.log.info({ agentId: req.user?.agentId, platform: parsed.data.platform }, "push device registered");
  res.json(RegisterDeviceResponse.parse({ ok: true }));
});

router.post("/push/devices/unregister", async (req, res): Promise<void> => {
  const parsed = UnregisterDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await unregisterDevice(parsed.data.token.trim());
  res.json(UnregisterDeviceResponse.parse({ ok: true }));
});

// Lets someone confirm from the app that notifications actually arrive on this
// phone, without waiting for a customer to write in.
router.post("/push/test", async (req, res): Promise<void> => {
  const devices = await devicesForUser(req.user!.email, req.user?.agentId ?? null);
  const delivered = await sendPush(
    devices,
    {
      title: "Notificaciones activas",
      body: "Así verás los mensajes nuevos y los chats que te asignen.",
      data: { type: "test" },
    },
    req.log,
  );

  // A silent `ok: false` is useless to whoever is setting this up, so say which
  // gateway is missing its credentials.
  const providers = pushProviderStatus();
  const needed = new Set(devices.map((d) => d.platform));
  const missing: string[] = [];
  if (needed.has("android") && !providers.fcm) missing.push("FCM (Android)");
  if (needed.has("ios") && !providers.apns) missing.push("APNs (iOS)");

  const detail =
    devices.length === 0
      ? "No hay ningún dispositivo registrado para tu usuario."
      : missing.length > 0
        ? `Falta configurar en el servidor: ${missing.join(" y ")}.`
        : delivered === 0
          ? "El servidor intentó enviarla pero la pasarela la rechazó. Revisa los logs."
          : null;

  res.json(SendTestPushResponse.parse({ ok: delivered > 0, devices: devices.length, detail }));
});

export default router;
