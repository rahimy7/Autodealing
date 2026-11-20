import test from "node:test";
import assert from "node:assert/strict";
import { SALES_PROMPT, SCHEDULER_PROMPT, DEALER_KB, LABELS, PHONE, ADDRESS } from "../tools/whatsapp-agents/spec.js";

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
