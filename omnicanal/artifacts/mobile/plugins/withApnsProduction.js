// `expo prebuild` deja `aps-environment: development` en el .entitlements y hace que
// las DOS configuraciones de Xcode, Debug y Release, compartan ese mismo archivo. EAS
// Build lo corrige por su cuenta antes de firmar, pero un archivo hecho a mano desde
// Xcode no: el build que sube a TestFlight pide su token al gateway de sandbox de APNs
// y producción lo rechaza. Y no vale con poner `production` a secas en el archivo
// único, porque entonces se rompe el camino contrario — un build de debug en un
// dispositivo necesita `development` (ver README → APNS_PRODUCTION).
//
// O sea que hace falta un .entitlements por configuración, y eso es una edición del
// .xcodeproj que el siguiente prebuild borraría. De ahí este plugin, igual que
// withReleaseSigning.js en Android.
//
// El reparto no es arbitrario: `IOSConfig.Entitlements.getEntitlementsPath` resuelve
// por defecto la configuración **Release**, así que el archivo que Expo gestiona —y
// donde escriben los demás plugins— tiene que seguir siendo el de Release. El que se
// saca aparte es el de Debug.
const fs = require("fs");
const path = require("path");

// pnpm no expone las dependencias transitivas de expo en node_modules/ de este
// paquete, así que hay que resolverlas a través de expo — igual que withReleaseSigning.
const resolver = (modulo) =>
  require.resolve(modulo, { paths: [require.resolve("expo/package.json")] });

const { withEntitlementsPlist, withXcodeProject, IOSConfig } = require(
  resolver("@expo/config-plugins"),
);
const plist = require(resolver("@expo/plist")).default;

const rutas = ({ modRequest }) => {
  const nombre = modRequest.projectName;
  return {
    // El que gestiona Expo. Va tal cual en buildSettings, relativo a ios/.
    release: `${nombre}/${nombre}.entitlements`,
    debug: `${nombre}/${nombre}Debug.entitlements`,
    dir: modRequest.platformProjectRoot,
  };
};

const escribir = (dir, relativa, contenido) => {
  const destino = path.join(dir, relativa);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, plist.build(contenido));
};

// Este mod corre ANTES que el de entitlements. Deja cada configuración apuntando a su
// archivo y ambos archivos creados, porque `ensureApplicationTargetEntitlementsFileConfigured`
// —que corre después— reasigna las dos configuraciones al archivo único en cuanto
// encuentra una que apunte a un archivo inexistente.
function withUnArchivoPorConfiguracion(config) {
  return withXcodeProject(config, (config) => {
    const proyecto = config.modResults;
    const { release, debug, dir } = rutas(config);

    const [, target] = IOSConfig.Target.findFirstNativeTarget(proyecto);
    const configuraciones = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      proyecto,
      target.buildConfigurationList,
    );

    let tocadas = 0;
    for (const [, bloque] of configuraciones) {
      const ruta = bloque.name === "Debug" ? debug : release;
      bloque.buildSettings.CODE_SIGN_ENTITLEMENTS = ruta;
      tocadas += 1;
    }

    // Si la plantilla de Expo cambia y dejamos de encontrar el target, preferimos
    // romper el prebuild a producir en silencio un archivo de TestFlight con el APNs
    // de sandbox: ese fallo no se ve hasta que una notificación no llega.
    if (tocadas === 0) {
      throw new Error(
        "[withApnsProduction] el target nativo no tiene configuraciones de build. " +
          "La plantilla del .xcodeproj cambió; actualiza plugins/withApnsProduction.js " +
          "antes de compilar un release.",
      );
    }

    // Contenido provisional; el mod de entitlements, más abajo, lo deja definitivo.
    for (const [ruta, entorno] of [[release, "production"], [debug, "development"]]) {
      if (!fs.existsSync(path.join(dir, ruta))) {
        escribir(dir, ruta, { "aps-environment": entorno });
      }
    }

    return config;
  });
}

// Corre DESPUÉS del de xcodeproj, sobre el archivo de Release: es el que Expo compone
// y donde han escrito ya los demás plugins. El de Debug se deriva de ese mismo objeto
// para que los dos no se separen el día que se añada otra capability.
function withApnsSegunConfiguracion(config) {
  return withEntitlementsPlist(config, (config) => {
    config.modResults["aps-environment"] = "production";
    const { debug, dir } = rutas(config);
    escribir(dir, debug, { ...config.modResults, "aps-environment": "development" });
    return config;
  });
}

module.exports = function withApnsProduction(config) {
  return withApnsSegunConfiguracion(withUnArchivoPorConfiguracion(config));
};
