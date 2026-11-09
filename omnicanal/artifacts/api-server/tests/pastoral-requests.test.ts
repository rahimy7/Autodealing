import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPastoralRequest } from "../src/lib/pastoral-requests";

test("classifies explicit requests using the four church categories", () => {
  for (const [text, type] of [["Quiero hacer una petición de oración", "prayer_request"], ["Oren por mi familia", "prayer_request"],
    ["Necesito una visita pastoral", "visitation"], ["Quisiera que me visiten", "visitation"],
    ["Quiero inscribirme a estudios bíblicos", "bible_study"], ["Deseo estudiar la Biblia", "bible_study"],
    ["Quiero organizar un culto en mi casa", "worship"]]) {
    assert.equal(detectPastoralRequest(text)?.type, type, text);
  }
});
test("does not register greetings, commerce, refusals or schedule questions", () => {
  for (const text of ["Hola", "Quiero afiliarme para vender", "Necesito un reembolso", "No quiero un estudio bíblico", "¿A qué hora es el culto?", "Quiero información del horario de oración", "Quiero saber a qué hora son los estudios bíblicos"]) {
    assert.equal(detectPastoralRequest(text), null, text);
  }
});
