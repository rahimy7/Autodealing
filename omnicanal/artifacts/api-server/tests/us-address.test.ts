import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUsAddress, splitName, stateCode } from "../src/lib/us-address";

describe("parseUsAddress", () => {
  it("lee la dirección del chat: nombre, calle con apartamento, ciudad, estado y ZIP", () => {
    assert.deepEqual(parseUsAddress("Juan Pérez, 123 Main St Apt 4, Miami, FL 33101"), {
      name: "Juan Pérez",
      streetAddress: "123 Main St",
      secondaryAddress: "Apt 4",
      city: "Miami",
      state: "FL",
      ZIPCode: "33101",
      ZIPPlus4: null,
    });
  });

  it("lee el formato de Shopify: calle, apto, ciudad, estado completo, ZIP y país", () => {
    assert.deepEqual(parseUsAddress("123 Main St, Apt 4, Miami, Florida, 33101, United States"), {
      name: null,
      streetAddress: "123 Main St",
      secondaryAddress: "Apt 4",
      city: "Miami",
      state: "FL",
      ZIPCode: "33101",
      ZIPPlus4: null,
    });
  });

  it("acepta saltos de línea, el ZIP+4 y el estado en minúsculas", () => {
    const a = parseUsAddress("456 Oak Avenue\nSuite 200\nNew York, ny 10018-1234\nUSA");
    assert.equal(a.streetAddress, "456 Oak Avenue");
    assert.equal(a.secondaryAddress, "Suite 200");
    assert.equal(a.city, "New York");
    assert.equal(a.state, "NY");
    assert.equal(a.ZIPCode, "10018");
    assert.equal(a.ZIPPlus4, "1234");
  });

  it("ciudad y estado en el mismo segmento, sin coma antes del estado", () => {
    const a = parseUsAddress("Juan Pérez, 123 Main St, Miami FL 33101");
    assert.deepEqual(
      { name: a.name, street: a.streetAddress, city: a.city, state: a.state, zip: a.ZIPCode },
      { name: "Juan Pérez", street: "123 Main St", city: "Miami", state: "FL", zip: "33101" },
    );
  });

  it("sin apartamento deja el secundario vacío", () => {
    const a = parseUsAddress("789 Pine Rd, Orlando, FL 32801");
    assert.equal(a.streetAddress, "789 Pine Rd");
    assert.equal(a.secondaryAddress, null);
    assert.equal(a.city, "Orlando");
  });

  it("separa un 'Apt' que viene pegado a la calle", () => {
    const a = parseUsAddress("12 Elm St #5B, Boston, MA 02108");
    assert.equal(a.streetAddress, "12 Elm St");
    assert.equal(a.secondaryAddress, "#5B");
  });

  it("sin comas rescata estado y ZIP del final y deja el resto en la calle", () => {
    const a = parseUsAddress("123 Main St Miami FL 33101");
    assert.equal(a.state, "FL");
    assert.equal(a.ZIPCode, "33101");
    assert.equal(a.streetAddress, "123 Main St Miami");
    assert.equal(a.city, "");
  });

  it("lo que no puede leer queda vacío en vez de inventarse", () => {
    assert.equal(parseUsAddress("Calle 5 #12, Santiago, República Dominicana").ZIPCode, "");
    assert.equal(parseUsAddress("").streetAddress, "");
    assert.equal(parseUsAddress(null).city, "");
  });
});

describe("stateCode y splitName", () => {
  it("reconoce códigos y nombres de estado", () => {
    assert.equal(stateCode("fl"), "FL");
    assert.equal(stateCode("New York"), "NY");
    assert.equal(stateCode("Puerto Rico"), "PR");
    assert.equal(stateCode("Santiago"), null);
    assert.equal(stateCode(""), null);
  });

  it("parte el nombre en nombre y apellidos", () => {
    assert.deepEqual(splitName("María del Carmen Pérez"), { firstName: "María", lastName: "del Carmen Pérez" });
    assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: "" });
    assert.deepEqual(splitName(null), { firstName: "", lastName: "" });
  });
});
