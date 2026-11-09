import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

// Las notas de voz de WhatsApp llegan en OGG/Opus, y el iPhone no lo reproduce: ni
// la app (AVPlayer) ni Safari abren un OGG. Se guardan convertidas a M4A (AAC),
// que suena en iOS, Android y cualquier navegador. La conversión la hace ffmpeg,
// que viene en la imagen Docker; sin él se guarda el original y la nota suena
// donde el OGG suene (Android, Chrome, Firefox).

// Formatos que ya suenan en todas partes: se guardan tal cual.
const PLAYABLE_EVERYWHERE = new Set(["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/mpeg", "audio/mp3"]);

export function needsConversion(mimeType: string): boolean {
  return !PLAYABLE_EVERYWHERE.has(mimeType.split(";")[0].trim().toLowerCase());
}

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
// Una nota de voz de varios minutos se convierte en uno o dos segundos; esto solo
// corta un ffmpeg colgado para que no retenga la respuesta al cliente.
const TIMEOUT_MS = 30_000;

// Sin ffmpeg instalado no tiene sentido intentarlo en cada nota: se avisa una vez.
let missing = false;

// Devuelve el audio en M4A, o null si no se pudo convertir.
export async function toM4a(data: Buffer): Promise<Buffer | null> {
  if (missing) return null;

  // Archivos temporales y no tuberías: el M4A lleva el índice (moov) al principio
  // para que el reproductor empiece a sonar sin descargarlo entero, y ffmpeg solo
  // puede moverlo ahí escribiendo en un archivo.
  const base = path.join(os.tmpdir(), `voice-${crypto.randomUUID()}`);
  const input = `${base}.in`;
  const output = `${base}.m4a`;
  try {
    await fs.writeFile(input, data);
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", input,
      "-vn",
      "-ac", "1",
      "-c:a", "aac",
      "-b:a", "64k",
      "-movflags", "+faststart",
      output,
    ]);
    return await fs.readFile(output);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" && e.syscall?.startsWith("spawn")) {
      missing = true;
      logger.warn(
        { ffmpeg: FFMPEG },
        "ffmpeg no está instalado: las notas de voz se guardan en su formato original y no suenan en el iPhone",
      );
    } else {
      logger.error({ err }, "voice note conversion to m4a failed");
    }
    return null;
  } finally {
    await Promise.all([fs.rm(input, { force: true }), fs.rm(output, { force: true })]);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg terminó con ${signal ?? `código ${code}`}: ${stderr.trim()}`));
    });
  });
}
