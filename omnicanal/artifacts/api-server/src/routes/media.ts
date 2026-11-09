import { Router, type IRouter } from "express";
import { downloadMedia, signMediaUrl } from "../lib/supabase";

const router: IRouter = Router();

const VALID_FILE = /^[\w.-]+$/;

// Enlace temporal a un adjunto, para abrirlo fuera de la app: el móvil le pasa
// documentos y videos al visor del sistema, que no puede mandar el token de
// sesión. Caduca pronto a propósito: es para abrirlo ahora, no para compartirlo.
router.get("/media/:file/link", async (req, res): Promise<void> => {
  const file = req.params.file;
  if (!VALID_FILE.test(file)) {
    res.status(400).json({ error: "Nombre de archivo inválido." });
    return;
  }

  const url = await signMediaUrl(file, 10 * 60);
  if (!url) {
    res.status(404).json({ error: "Archivo no disponible." });
    return;
  }
  res.json({ url });
});

// Serves stored message media (voice notes, photos, documents) from the Supabase
// bucket. Mounted behind requireAuth, so only logged-in users can fetch it.
router.get("/media/:file", async (req, res): Promise<void> => {
  const file = req.params.file;
  if (!VALID_FILE.test(file)) {
    res.status(400).json({ error: "Nombre de archivo inválido." });
    return;
  }

  const media = await downloadMedia(file);
  if (!media) {
    res.status(404).json({ error: "Archivo no encontrado." });
    return;
  }

  res.setHeader("content-type", media.contentType);
  res.setHeader("cache-control", "private, max-age=31536000, immutable");
  res.send(media.data);
});

export default router;
