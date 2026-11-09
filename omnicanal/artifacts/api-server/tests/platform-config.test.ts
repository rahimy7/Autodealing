import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const { resolveClientConfig, defineClient, CLIENT_IDS, MODULE_KEYS } = await import(
  "@workspace/platform-config"
);

describe("platform-config — resolución de la instancia", () => {
  it("usa el cliente de respaldo cuando la instancia no declara CLIENT_ID", () => {
    const resolved = resolveClientConfig({});
    assert.equal(resolved.clientId, "premier");
    // El aviso del arranque depende de esto: sin `explicit`, nadie se entera de
    // que la instancia está corriendo con la configuración de otro.
    assert.equal(resolved.explicit, false);
  });

  it("resuelve el cliente que declara CLIENT_ID", () => {
    const resolved = resolveClientConfig({ CLIENT_ID: "demo" });
    assert.equal(resolved.config.id, "demo");
    assert.equal(resolved.explicit, true);
    assert.equal(resolved.overridden, false);
  });

  it("falla al arrancar con un CLIENT_ID desconocido, nombrando los que existen", () => {
    assert.throws(
      () => resolveClientConfig({ CLIENT_ID: "no-existe" }),
      (err: Error) => err.message.includes("no-existe") && err.message.includes(CLIENT_IDS[0]),
    );
  });

  it("mezcla CLIENT_CONFIG_JSON encima sin perder lo que no toca", () => {
    const { config, overridden } = resolveClientConfig({
      CLIENT_ID: "demo",
      CLIENT_CONFIG_JSON: JSON.stringify({ branding: { primaryColor: "#E11D48" } }),
    });

    assert.equal(overridden, true);
    assert.equal(config.branding.primaryColor, "#E11D48");
    // La mezcla es profunda: el resto de la marca sigue siendo la del repositorio.
    assert.equal(config.branding.productName, "Omnicanal");
    assert.equal(config.modules.instagram, false);
  });

  it("ignora un id dentro de CLIENT_CONFIG_JSON: quién es la instancia lo dice CLIENT_ID", () => {
    const { config } = resolveClientConfig({
      CLIENT_ID: "demo",
      CLIENT_CONFIG_JSON: JSON.stringify({ id: "premier", name: "Otro" }),
    });

    assert.equal(config.id, "demo");
    assert.equal(config.name, "Otro");
  });

  it("rechaza un CLIENT_CONFIG_JSON malformado en vez de arrancar a medias", () => {
    assert.throws(
      () => resolveClientConfig({ CLIENT_ID: "demo", CLIENT_CONFIG_JSON: "{no es json" }),
      /CLIENT_CONFIG_JSON no es JSON válido/,
    );
  });

  it("rechaza un color de marca que no es hexadecimal", () => {
    assert.throws(
      () =>
        resolveClientConfig({
          CLIENT_ID: "demo",
          CLIENT_CONFIG_JSON: JSON.stringify({ branding: { primaryColor: "rojo" } }),
        }),
      /primaryColor/,
    );
  });
});

describe("platform-config — valores por defecto", () => {
  it("un cliente nuevo recibe el core completo", () => {
    const config = defineClient({ id: "cliente-021", name: "Cliente 021" });
    for (const key of MODULE_KEYS) {
      assert.equal(config.modules[key], true, `el módulo ${key} debería venir encendido`);
    }
  });

  it("un cliente sin avisos de traspaso propios usa los del core", () => {
    const config = defineClient({ id: "cliente-022", name: "Cliente 022" });
    assert.deepEqual(config.business.handoffNotices, { sales: null, service: null, order: null, weekend: null });
  });

  it("las imágenes del agente son opcionales y su clave sirve para la marca [[IMAGEN:…]]", () => {
    assert.deepEqual(defineClient({ id: "cliente-022", name: "Cliente 022" }).business.agentImages, {});
    assert.throws(
      () =>
        defineClient({
          id: "cliente-022",
          name: "Cliente 022",
          business: { agentImages: { "Cuentas Banco": { url: "/x.jpg", description: "las cuentas" } } },
        }),
      /minúsculas/,
    );
  });

  it("los agentes se presentan con su nombre salvo que el cliente lo apague", () => {
    assert.equal(defineClient({ id: "cliente-022", name: "Cliente 022" }).business.agentsIntroduceByName, true);
    assert.equal(
      defineClient({ id: "cliente-023", name: "Cliente 023", business: { agentsIntroduceByName: false } }).business
        .agentsIntroduceByName,
      false,
    );
  });

  it("no exige más que id y nombre", () => {
    const config = defineClient({ id: "cliente-022", name: "Cliente 022" });
    assert.equal(config.locale.timezone, "America/Santo_Domingo");
    assert.equal(config.branding.primaryColor, null);
    assert.deepEqual(config.extensions, []);
  });

  it("no acepta un identificador que no sirva como CLIENT_ID", () => {
    assert.throws(() => defineClient({ id: "Cliente 21", name: "Cliente 21" }), /id/);
  });
});

// Esta copia es la instancia de Premier Line Motors, y el sitio del concesionario
// le habla por API: contactos, agenda, bases de conocimiento, reportes y
// conversaciones. Si uno de esos módulos se apaga, la integración se rompe.
describe("platform-config — Premier Line Motors", () => {
  const premier = resolveClientConfig({ CLIENT_ID: "premier" }).config;

  it("es una configuración del repositorio y la de respaldo", () => {
    assert.ok(CLIENT_IDS.includes("premier"));
    assert.equal(resolveClientConfig({}).config.id, "premier");
  });

  it("mantiene encendido lo que usa el sitio web", () => {
    for (const key of ["whatsapp", "instagram", "facebook", "inbox", "crm", "aiAgents", "knowledgeBases", "appointments", "analytics"] as const) {
      assert.equal(premier.modules[key], true, `el sitio necesita el módulo ${key}`);
    }
  });

  it("razona con el reloj y la moneda del concesionario", () => {
    // El sitio guarda las citas en America/New_York (server/omni-service.js, DEALER_TZ).
    assert.equal(premier.locale.timezone, "America/New_York");
    assert.equal(premier.locale.currency, "USD");
  });

  it("su logo está en la carpeta pública del panel", () => {
    assert.ok(premier.branding.logoUrl);
    const file = new URL(`../../omnicanal/public${premier.branding.logoUrl}`, import.meta.url);
    assert.ok(existsSync(file), `falta ${file.pathname}`);
  });
});
