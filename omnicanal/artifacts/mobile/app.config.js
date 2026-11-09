// La configuración estática vive en app.json; este archivo solo añade lo que hay
// que decidir en tiempo de prebuild.
//
// El único caso hoy es el de FCM. Para que las notificaciones lleguen en Android,
// el prebuild tiene que copiar `google-services.json` dentro de android/app/ y
// aplicar el plugin de Gradle `com.google.gms.google-services`, y eso solo lo hace
// si `android.googleServicesFile` está declarado. Sin él, el manifiesto queda con
// la metadata de Firebase pero sin remitente configurado, y el registro del
// dispositivo revienta en tiempo de ejecución con el error que push.ts ya predice
// ("On Android this is almost always a missing google-services.json in the build").
//
// Y no se declara fijo en app.json porque entonces `expo prebuild` FALLA cuando el
// archivo no está — y no está nunca en un clon limpio: es una credencial y está en
// .gitignore. Declararlo solo si existe deja las dos cosas funcionando: quien tiene
// las credenciales obtiene push, y quien no, puede seguir generando los proyectos
// nativos y compilar la app.
const fs = require("fs");
const path = require("path");

const GOOGLE_SERVICES = "./google-services.json";

// Expo evalúa este archivo varias veces por comando; sin esto el aviso sale
// cuatro veces seguidas y se convierte en ruido que se deja de leer.
let avisado = false;

module.exports = ({ config }) => {
  if (fs.existsSync(path.join(__dirname, GOOGLE_SERVICES))) {
    config.android = { ...config.android, googleServicesFile: GOOGLE_SERVICES };
  } else if (!avisado) {
    avisado = true;
    console.warn(
      "[app.config] Sin google-services.json: las notificaciones push de Android no " +
        "funcionarán en este build. Ver README → «Credenciales de Android (FCM)».",
    );
  }
  return config;
};
