import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { audioExtension } = await import("../src/lib/openai-client.js");

describe("openai-client — audioExtension", () => {
  const cases: Array<[string, string]> = [
    ["audio/ogg", "ogg"],
    ["audio/ogg; codecs=opus", "ogg"],
    ["audio/opus", "ogg"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/mp4", "mp4"],
    ["audio/m4a", "m4a"],
    ["audio/aac", "m4a"],
    ["audio/wav", "wav"],
    ["audio/webm", "webm"],
    ["application/octet-stream", "ogg"], // unknown falls back to ogg
    ["", "ogg"],
  ];

  for (const [mime, expected] of cases) {
    it(`maps "${mime}" → ${expected}`, () => {
      assert.equal(audioExtension(mime), expected);
    });
  }
});
