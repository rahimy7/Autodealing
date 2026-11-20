import { Router, type IRouter } from "express";
import { downloadMedia } from "../lib/supabase";
import { verifyMediaSignature } from "../lib/media-signature";

const router: IRouter = Router();

const VALID_FILE = /^[\w.-]+$/;
// Only what a customer's chat app can show. Anything else is sent as a download, never rendered.
const INLINE_TYPE = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/i;

// A stored file for whoever holds a signed link (lib/supabase.ts hands them out when the files are
// kept in the database): Meta fetches the picture of a welcome message or a campaign from here,
// with no session. The signature names this file and an expiry, so a link opens nothing else.
router.get("/public-media/:file", async (req, res): Promise<void> => {
  const file = req.params.file;
  if (!VALID_FILE.test(file)) {
    res.status(400).json({ error: "Nombre de archivo inválido." });
    return;
  }
  const exp = Number(req.query.exp);
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  if (!verifyMediaSignature(process.env.SESSION_SECRET ?? "", file, exp, sig)) {
    res.status(403).json({ error: "Enlace inválido o vencido." });
    return;
  }

  const media = await downloadMedia(file);
  if (!media) {
    res.status(404).json({ error: "Archivo no encontrado." });
    return;
  }

  const inline = INLINE_TYPE.test(media.contentType);
  res.setHeader("content-type", inline ? media.contentType : "application/octet-stream");
  if (!inline) res.setHeader("content-disposition", "attachment");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "private, max-age=300");
  res.send(media.data);
});

export default router;
