# OmniAI — app móvil

App nativa (React Native) para **administradores y agentes**. Cubre las mismas
funciones del panel web y añade **notificaciones push** cuando entra un mensaje o
te asignan un chat.

Comparte el contrato con el backend a través de `@workspace/api-client-react`,
así que cualquier cambio en `lib/api-spec/openapi.yaml` llega aquí con un
`pnpm --filter @workspace/api-spec run codegen`.

## Sin dependencia de servicios de Expo

Las librerías `expo-*` son paquetes MIT que corren en local, pero **ningún
servicio en la nube de Expo participa**:

- El push va **directo a FCM (Android) y APNs (iOS)** desde nuestro servidor. No
  hay relé intermedio ni cuenta de Expo.
- Los builds se hacen **en local** con Gradle y Xcode (`expo prebuild` genera los
  proyectos nativos una vez). No se usa EAS Build.
- No hace falta cuenta de Expo para nada.

---

## Qué trae

**Agente** (5 pestañas)

| Pantalla | Qué hace |
| --- | --- |
| Inicio | Resumen de sus chats, sin leer, tasa de resolución, estado y canales |
| Mis chats | Sus conversaciones, con filtros por canal, estado y búsqueda |
| General | Todo el panel del equipo en lectura; puede tomar cualquier chat |
| Productos | Catálogo con búsqueda, categorías y compartir ficha al cliente |
| Perfil | Estado, canales, notificaciones, cambio de contraseña, cerrar sesión |

**Administrador** (4 pestañas + menú "Más")

| Pantalla | Qué hace |
| --- | --- |
| Panel | KPIs, volumen diario, desglose por canal y desempeño por agente |
| Bandeja | Todas las conversaciones de la operación |
| Contactos | CRM: búsqueda, etiquetas, alta, ficha completa, edición y borrado |
| Campañas | Estado, destinatarios, métricas, envío inmediato y borrado |
| Comentarios | Hilos de Facebook/Instagram: responder, publicar borradores IA, migrar a DM |
| Monitor | Cola en vivo: sin asignar, con la IA y carga por persona |
| Reportes | 7/30/90 días por agente, canal e intención |
| Agentes | Humanos y virtuales: estado, canales, activar/desactivar, contraseña |
| Flujos | Reglas de enrutado por intención, activar/desactivar |
| Etiquetas | Intenciones que clasifica la IA, auto-respuesta y migración a DM |
| Grupos | Miembros y regla de reparto |
| Mensajes personalizados | Bienvenidas con botones: editar y activar |
| Ajustes | Plan, credenciales de Meta, activar canales y probar conexión |

**Conversación** (compartida por ambos roles): hilo con audios transcritos e
imágenes, separadores por día, envío, marcar leído, tomar, asignar, escalar y
resolver.

---

## Notificaciones

El teléfono registra su token **nativo** (`getDevicePushTokenAsync`) y el
servidor lo guarda en `device_tokens` junto con la plataforma. Al enviar,
`artifacts/api-server/src/lib/push.ts` reparte cada aviso por su pasarela:
Android → `push-fcm.ts`, iOS → `push-apns.ts`. Un token que la pasarela declara
desconocido se borra del registro solo.

Quién recibe qué lo decide el servidor, nunca el dispositivo:

- **Mensaje entrante** → al agente humano dueño del chat. Si no lo lleva nadie
  (sin asignar o en cola) → a los administradores. Un chat que un agente virtual
  está atendiendo bien no notifica a nadie, salvo que pongas
  `PUSH_NOTIFY_ADMINS_ON_BOT_CHATS=true`.
- **Asignación** → a la persona que la recibe, venga de `/assign` (admin), de una
  escalación o de una regla de flujo.
- **Cola de grupo sin dueño** → a los administradores.

Al tocar la notificación la app abre esa conversación, esté cerrada o en segundo
plano.

---

## Puesta en marcha

### 1. Base de datos

```bash
pnpm --filter @workspace/db run push
```

> Ojo: `drizzle-kit push` compara todo el esquema. Si detecta deriva puede
> proponer borrados; revisa lo que lista antes de aceptar.

### 2. Credenciales de Android (FCM) — gratis

1. [Firebase Console](https://console.firebase.google.com) → crea un proyecto (o
   reutiliza uno).
2. Añade una app Android con el package `com.rvrservice.omniai`.
3. Descarga `google-services.json` y déjalo en `artifacts/mobile/`. Está
   gitignorado; `app.json` ya lo apunta.
4. Project settings → Service accounts → **Generate new private key**. Ese JSON
   va al backend como `FCM_SERVICE_ACCOUNT_JSON` (en una línea) o
   `FCM_SERVICE_ACCOUNT_FILE` (ruta al archivo).

No se usa el SDK de Firebase en la app: `google-services.json` solo le da al
sistema el remitente FCM con el que registrar el dispositivo.

### 3. Credenciales de iOS (APNs) — requiere Apple Developer ($99/año)

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → crea una
   clave con *Apple Push Notifications service (APNs)* marcado.
2. Descarga el `.p8` (solo se puede una vez) y anota el **Key ID**. El **Team
   ID** está arriba a la derecha del portal.
3. En el backend: `APNS_KEY_P8` (o `APNS_KEY_FILE`), `APNS_KEY_ID`,
   `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.rvrservice.omniai`.
4. `APNS_PRODUCTION=false` mientras pruebes con un build de debug — esos
   dispositivos reciben su token del gateway de sandbox y producción los rechaza.

### 4. Apuntar la app al backend

```bash
EXPO_PUBLIC_API_URL=https://tu-dominio.com
```

Sin esa variable, en desarrollo la app usa la IP de la máquina que corre Metro en
el puerto 8080, que es donde escucha `@workspace/api-server`.

---

## Compilar en local

Una vez, para generar los proyectos nativos:

```bash
cd artifacts/mobile
npx expo prebuild            # crea android/ e ios/ (ambos gitignorados)
```

Después:

```bash
# Android — necesita Android Studio / SDK
pnpm --filter @workspace/mobile run android            # debug, en el móvil conectado
pnpm --filter @workspace/mobile run android:release    # APK de release

# iOS — necesita Xcode
pnpm --filter @workspace/mobile run ios
pnpm --filter @workspace/mobile run ios:release
```

El APK de release queda en
`android/app/build/outputs/apk/release/app-release.apk`. Se instala directamente
en los teléfonos del equipo; no hace falta la Play Store para uso interno.

### Publicar en Play Store (AAB firmado)

```bash
pnpm --filter @workspace/mobile run android:aab
```

Deja el bundle en `android/app/build/outputs/bundle/release/app-release.aab`.

La primera ejecución crea el keystore de subida en `~/.keystores/` — **fuera del
repo a propósito**: `expo prebuild --clean` borra `android/` entera y `git clean
-xdf` se lleva todo lo ignorado, y perder esa clave significa no poder volver a
actualizar la app ya publicada. Imprime la contraseña generada una sola vez;
guárdala en el gestor de contraseñas junto con una copia del `.jks`.

Gradle lee las credenciales de `android/keystore.properties`, que el script copia
desde `~/.keystores` en cada build. La configuración de firma la reinyecta
`plugins/withReleaseSigning.js` en cada prebuild, porque la plantilla de Expo
firma el release con el keystore de *debug* y un AAB así lo rechaza Play Store al
subirlo.

Sube `android.versionCode` en `app.json` antes de cada entrega: Play Store rechaza
un bundle cuyo `versionCode` ya exista.

### Publicar en TestFlight / App Store (IPA firmado)

El archivo se genera desde Xcode (*Product → Archive*), no con EAS. Tres cosas
que hay que respetar y que no avisan hasta que el build ya está subido:

**Sube `ios.buildNumber` en `app.json` antes de cada entrega**, igual que el
`versionCode` de Android. App Store Connect rechaza un archivo cuya pareja
`version` + `buildNumber` ya exista, y el rechazo llega por correo: en TestFlight
sigues viendo el build anterior como si no hubieras subido nada. Ojo con que
`ios/OmniAI/Info.plist` va por su cuenta una vez generado — si compilas sin
prebuild, el número que cuenta es el del Info.plist.

**El `aps-environment` de release lo pone `plugins/withApnsProduction.js`.** Un
build de TestFlight o App Store pide su token al gateway de **producción** de
APNs, pero `expo prebuild` escribe `development` en el `.entitlements` y lo
comparte entre Debug y Release. El plugin genera un segundo archivo,
`OmniAIRelease.entitlements`, y apunta ahí solo la configuración Release; Debug
se queda en sandbox, que es lo que necesita un build en un dispositivo. Si
alguna vez ves que las push llegan en debug pero no en TestFlight, empieza por
aquí y por `APNS_PRODUCTION` en el backend.

**El cumplimiento de exportación ya está respondido** con
`ITSAppUsesNonExemptEncryption: false` en `app.json`. Sin esa clave, cada build
se queda en App Store Connect con el aviso «Falta cumplimiento de exportación» y
los testers no lo pueden instalar hasta que alguien conteste la pregunta a mano.
La app solo habla HTTPS, que cuenta como cifrado exento.

Día a día, con la app ya instalada:

```bash
pnpm --filter @workspace/api-server run dev    # backend
pnpm --filter @workspace/mobile run start      # servidor de Metro
```

Comprobaciones:

```bash
pnpm --filter @workspace/mobile run typecheck
cd artifacts/mobile && npx expo-doctor
```

---

## Verificar que las notificaciones llegan

En la app: **Perfil / Más → Notificaciones → Enviar notificación de prueba**. Si
algo falta, el servidor responde diciendo exactamente qué pasarela no tiene
credenciales en vez de fallar en silencio.

Las push **no funcionan en simulador ni emulador**: hace falta un teléfono real.

---

## Notas

- La sesión se guarda en el llavero del teléfono (`expo-secure-store`) y el token
  del backend dura 12 horas, así que la app pedirá login una vez al día.
- Al cerrar sesión el dispositivo se da de baja del registro de push, de modo que
  el siguiente usuario de ese teléfono no reciba los chats del anterior.
- El editor visual de flujos y la creación de campañas siguen siendo del panel
  web: en el móvil se consultan, se activan y se envían.
- La app no lleva iconos ni splash propios todavía; usa los de Expo. Para
  ponerlos, añade los PNG y declara `icon`, `splash` y `android.adaptiveIcon` en
  `app.json`.
