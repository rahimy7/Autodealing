import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  caseCode,
  isOpenCaseStatus,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  CASE_RESOLUTION_KINDS,
  CASE_RESOLUTION_LABELS,
} from "../src/lib/cases";

describe("caseCode", () => {
  it("pads the id into a display code the team can read out loud", () => {
    assert.equal(caseCode(1), "CASO-000001");
    assert.equal(caseCode(123), "CASO-000123");
    assert.equal(caseCode(1_000_000), "CASO-1000000");
  });
});

describe("isOpenCaseStatus", () => {
  it("counts as pending work everything except the two ways a case ends", () => {
    assert.equal(isOpenCaseStatus("open"), true);
    assert.equal(isOpenCaseStatus("in_progress"), true);
    assert.equal(isOpenCaseStatus("waiting_customer"), true);
    assert.equal(isOpenCaseStatus("resolved"), false);
    assert.equal(isOpenCaseStatus("cancelled"), false);
  });
});

describe("etiquetas", () => {
  // El panel pinta por estos mapas: una clave sin etiqueta sale en blanco en la
  // tabla, y eso no lo ve el compilador de una fila renderizada dinámicamente.
  it("every type, status and resolution has a label", () => {
    for (const t of CASE_TYPES) assert.ok(CASE_TYPE_LABELS[t], `falta la etiqueta de ${t}`);
    for (const s of CASE_STATUSES) assert.ok(CASE_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    for (const k of CASE_RESOLUTION_KINDS) assert.ok(CASE_RESOLUTION_LABELS[k], `falta la etiqueta de ${k}`);
  });

  it("keeps the two ways of closing a case that the business asked for", () => {
    assert.ok(CASE_RESOLUTION_KINDS.includes("answered"));
    assert.ok(CASE_RESOLUTION_KINDS.includes("actioned"));
  });
});
