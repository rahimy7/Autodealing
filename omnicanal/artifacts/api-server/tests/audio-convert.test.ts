import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { needsConversion, toM4a } from "../src/lib/audio-convert.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;

describe("notas de voz — conversión a M4A", () => {
  it("convierte el OGG de WhatsApp y deja tal cual lo que ya suena en todas partes", () => {
    assert.equal(needsConversion("audio/ogg; codecs=opus"), true);
    assert.equal(needsConversion("audio/amr"), true);
    assert.equal(needsConversion("audio/mp4"), false);
    assert.equal(needsConversion("audio/mpeg"), false);
  });

  it("un OGG/Opus sale como M4A", { skip: !hasFfmpeg && "ffmpeg no está instalado" }, async () => {
    // Un segundo de tono en OGG/Opus, como el que manda WhatsApp.
    const ogg = spawnSync(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", "-f", "ogg", "pipe:1"],
      { maxBuffer: 10 * 1024 * 1024 },
    ).stdout;
    assert.ok(ogg.length > 0, "no se pudo generar el OGG de prueba");

    const m4a = await toM4a(ogg);
    assert.ok(m4a, "la conversión devolvió null");
    // Un MP4/M4A empieza con la caja "ftyp".
    assert.equal(m4a.subarray(4, 8).toString("latin1"), "ftyp");
  });
});
