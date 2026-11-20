import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SALES_PROMPT, SCHEDULER_PROMPT, DEALER_KB, LABELS, WELCOME, PHONE, ADDRESS } from "../tools/whatsapp-agents/spec.js";

test("WhatsApp agents: the dealer's published contact data is used everywhere", () => {
  for (const text of [SALES_PROMPT, SCHEDULER_PROMPT, DEALER_KB]) assert.ok(text.includes(PHONE), "phone");
  for (const text of [SCHEDULER_PROMPT, DEALER_KB]) assert.ok(text.includes(ADDRESS), "address");
});

test("WhatsApp agents: both prompts keep the rules that protect customers", () => {
  for (const prompt of [SALES_PROMPT, SCHEDULER_PROMPT]) {
    assert.match(prompt, /Eres una inteligencia artificial/);
    assert.match(prompt, /Seguro Social/);
    assert.match(prompt, /No inventes|Nunca inventes/);
  }
  assert.match(SALES_PROMPT, /nunca prometas aprobación/i);
  assert.match(SALES_PROMPT, /no des cifras/i);
});

test("WhatsApp agents: the scheduler passes sales questions on silently", () => {
  assert.match(SCHEDULER_PROMPT, /ESCALAR_A_HUMANO/);
  assert.match(SCHEDULER_PROMPT, /domingos no/);
});

test("WhatsApp agents: three intent labels, each described in both languages", () => {
  assert.deepEqual(LABELS.map((l) => l.key), ["inventory", "finance", "appointment"]);
  for (const l of LABELS) {
    assert.match(l.color, /^#[0-9a-f]{6}$/i);
    assert.ok(l.description.includes(" / "), `${l.key} needs the English half`);
  }
});

test("WhatsApp agents: the knowledge base never states what the dealer has not published", () => {
  assert.match(DEALER_KB, /Horario: no está publicado/);
  assert.match(DEALER_KB, /Lo que NO se sabe/);
  assert.doesNotMatch(DEALER_KB, /\$\s?\d/);
});

test("WhatsApp welcome: fits what WhatsApp accepts and its picture is served by the site", () => {
  assert.ok(WELCOME.body.length <= 1024, "interactive bodies are capped at 1024 characters");
  assert.ok(WELCOME.buttons.length >= 1 && WELCOME.buttons.length <= 3, "at most 3 buttons");
  for (const b of WELCOME.buttons) {
    assert.ok(b.label.length <= 20, `${b.label} is over 20 characters`);
    assert.match(b.id, /^[a-z0-9_-]+$/i);
  }
  assert.equal(new Set(WELCOME.buttons.map((b) => b.id)).size, WELCOME.buttons.length);
  assert.match(WELCOME.imagePath, /^\/img\/[A-Za-z0-9._/-]+$/);
  assert.ok(fs.existsSync(new URL(`..${WELCOME.imagePath}`, import.meta.url)), "the picture must be in img/");
  assert.match(WELCOME.body, /asistente virtual/, "says it is a virtual assistant");
  assert.deepEqual(WELCOME.channels, ["whatsapp"]);
});
