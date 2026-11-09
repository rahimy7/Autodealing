// `expo prebuild --clean` regenera android/app/build.gradle desde la plantilla de
// Expo, y esa plantilla firma el build de release con el keystore de *debug*. Un
// AAB firmado así lo rechaza Play Store, así que la configuración de firma no
// puede vivir editada a mano en android/: se borraría en el siguiente prebuild y
// el error solo aparecería al subir el archivo.
//
// Este plugin la vuelve a inyectar en cada prebuild. Lee las credenciales de
// android/keystore.properties (que escribe scripts/build-android-aab.sh) y, si el
// archivo no está, deja el release con la firma de debug para que un clon sin
// credenciales pueda seguir compilando.
// pnpm no expone las dependencias transitivas de expo en node_modules/ de este
// paquete, así que @expo/config-plugins hay que resolverlo a través de expo — la
// misma técnica que usa el build.gradle que genera el propio Expo.
const { withAppBuildGradle } = require(
  require.resolve("@expo/config-plugins", {
    paths: [require.resolve("expo/package.json")],
  }),
);

const CARGA_PROPIEDADES = `// Credenciales de firma de release; las escribe scripts/build-android-aab.sh.
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;

const CONFIG_RELEASE = `        release {
            if (keystoreProperties.containsKey('storeFile')) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
`;

const FIRMA_CONDICIONAL =
  "signingConfig keystoreProperties.containsKey('storeFile') ? signingConfigs.release : signingConfigs.debug";

// Los anclajes son texto de la plantilla de Expo, o sea que una actualización del
// SDK puede moverlos. Si eso pasa preferimos romper el prebuild a producir en
// silencio un AAB firmado con debug que solo falla al subirlo a Play.
function exigir(condicion, mensaje) {
  if (!condicion) {
    throw new Error(
      `[withReleaseSigning] ${mensaje}. La plantilla de android/app/build.gradle ` +
        `cambió; actualiza plugins/withReleaseSigning.js antes de compilar un release.`,
    );
  }
}

function inyectarFirma(gradle) {
  if (gradle.includes("keystorePropertiesFile")) return gradle; // prebuild sin --clean

  let salida = CARGA_PROPIEDADES + gradle;

  const anclaSigningConfigs = "    signingConfigs {\n        debug {";
  exigir(
    salida.includes(anclaSigningConfigs),
    "no se encontró el bloque signingConfigs.debug",
  );
  salida = salida.replace(
    anclaSigningConfigs,
    `    signingConfigs {\n${CONFIG_RELEASE}        debug {`,
  );

  // El buildType `debug` también dice `signingConfig signingConfigs.debug`, así que
  // no vale un replace global: hay que cambiar solo el que está dentro de `release`.
  const inicioBuildTypes = salida.indexOf("buildTypes {");
  exigir(inicioBuildTypes !== -1, "no se encontró el bloque buildTypes");
  const inicioRelease = salida.indexOf("release {", inicioBuildTypes);
  exigir(inicioRelease !== -1, "no se encontró el buildType release");
  const inicioFirma = salida.indexOf(
    "signingConfig signingConfigs.debug",
    inicioRelease,
  );
  exigir(
    inicioFirma !== -1,
    "el buildType release no firma con signingConfigs.debug",
  );

  return (
    salida.slice(0, inicioFirma) +
    FIRMA_CONDICIONAL +
    salida.slice(inicioFirma + "signingConfig signingConfigs.debug".length)
  );
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    exigir(
      config.modResults.language === "groovy",
      `build.gradle está en ${config.modResults.language}, no en groovy`,
    );
    config.modResults.contents = inyectarFirma(config.modResults.contents);
    return config;
  });
};
