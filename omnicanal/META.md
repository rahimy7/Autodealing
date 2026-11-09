# Configuración de Meta — Facebook, Instagram y WhatsApp

Guía para conectar los tres canales y publicar la app en el panel de Meta
(`developers.facebook.com/apps/<APP_ID>`).

Todo lo que la app hace contra la Graph API está en
[artifacts/api-server/src/lib/meta.ts](artifacts/api-server/src/lib/meta.ts). Las
credenciales **no** son variables de entorno: el administrador las guarda en
*Configuración → Conexión con Meta* y viven en la base de datos
(`integration_settings`).

Versión de Graph que usa la app: **v21.0**
([meta.ts:7](artifacts/api-server/src/lib/meta.ts#L7)).

---

## 0. Camino mínimo: empezar a recibir mensajes de Facebook e Instagram

**No requiere App Review**, pero sí **publicar la app**. Para atender clientes
reales hace falta además acceso avanzado a `pages_messaging` e
`instagram_manage_messages` → review + verificación del negocio (secciones 1-6
y 9).

> ⚠ **Con la app sin publicar no llegan webhooks reales — de nadie.** La pantalla
> de webhooks lo dice sin rodeos: *«Las apps solo podrán recibir webhooks de prueba
> enviados desde el panel mientras la app esté sin publicar. No se entregarán datos
> de producción, incluidos los de los administradores, desarrolladores o
> evaluadores de la app»*. Tener rol en la app **no** es suficiente. El síntoma
> típico: el evento de prueba del panel entra y un comentario real no aparece
> nunca. Publicar es lo primero, antes incluso de grabar el screencast.

Permisos necesarios en esta etapa — nada más:

```
pages_messaging   pages_manage_metadata   pages_show_list
instagram_basic   instagram_manage_messages
```

1. La app tiene que estar desplegada con **HTTPS público** (Meta no acepta
   `localhost`): `https://<tu-dominio>/api/webhooks/meta`.
2. En la app, *Configuración → Conexión con Meta*: guarda **App ID**, **App
   Secret** y el **Webhook Verify Token** que tú elijas. Guardar aquí va primero:
   el handshake de Meta compara contra la base de datos.
3. Panel de Meta → *Messenger from Meta → Configuración de la API de Messenger*:
   conecta la página, genera y copia el **Page Access Token**.
4. *Messenger from Meta → Webhooks*: pega la URL de callback y el verify token →
   *Verificar y guardar*. Suscribe el campo **`messages`** (el único que hace
   falta, ver la nota de la sección 7). Después **suscribe la página** (paso
   aparte — es la causa nº 1 de "no llega nada").
5. *Messenger from Meta → Configuración de Instagram*: conecta la cuenta
   profesional y suscribe el campo `messages`.
6. En la app: **Page ID** + Page Access Token, **Instagram Business Account ID**
   (el token de IG puede quedar vacío), activa los dos switches, *Guardar*, y
   *Probar conexión* en cada tarjeta.
7. En la app de Instagram del teléfono: *Configuración → Mensajes → Herramientas
   de terceros → **Permitir el acceso a los mensajes*** activado.
8. Escríbele a la página desde tu Facebook y a la cuenta desde tu Instagram. En
   los logs deben aparecer `webhook received` y `webhook inbound events parsed`.

> **El token que genera el panel de Messenger trae solo los permisos de
> mensajería.** En concreto tiene `pages_messaging` pero **no**
> `pages_read_engagement` ni `pages_manage_metadata`. Eso es suficiente para
> recibir y responder DMs: `pages_read_engagement` solo lo usa la vista previa de
> publicaciones del módulo Feed, y `pages_manage_metadata` solo sirve para
> suscribir la página por API (algo que el panel ya hizo por ti). Si necesitas un
> token con más permisos, genéralo desde el Explorador de la API Graph marcando
> los scopes que quieras, no desde el panel de Messenger.

Cuando esto funcione, sigue con el review — y aprovecha estas mismas pruebas para
grabar el screencast (sección 5) y para cubrir las llamadas de prueba obligatorias
(sección 3).

---

## 1. Qué usa realmente la app (fuente de la verdad para el review)

| Función en el producto | Endpoint de Graph | Permiso requerido |
| --- | --- | --- |
| Recibir DMs de Messenger | webhook `page` → `messaging` | `pages_messaging` |
| Responder DMs de Messenger (IA + agente humano) | `POST /me/messages` (`messaging_type: RESPONSE`) | `pages_messaging` |
| Suscribir la página al webhook | `POST /{page-id}/subscribed_apps` | `pages_manage_metadata` |
| Leer comentarios en publicaciones de la página | webhook `page` → `feed` | `pages_read_engagement` |
| Vista previa del post en el módulo Feed | `GET /{post-id}?fields=message,permalink_url,full_picture` | `pages_read_engagement` |
| Responder públicamente un comentario | `POST /{comment-id}/comments` | `pages_manage_engagement` |
| Respuesta privada desde un comentario (FB) | `POST /me/messages` con `recipient.comment_id` | `pages_messaging` |
| Obtener el Page Access Token | `GET /me/accounts` | `pages_show_list` |
| Recibir y responder DMs de Instagram | webhook `instagram` → `messaging`, `POST /me/messages` | `instagram_manage_messages` |
| Recibir comentarios de Instagram | webhook `instagram` → `comments` | `instagram_manage_comments` |
| Responder un comentario de Instagram | `POST /{comment-id}/replies` | `instagram_manage_comments` |
| Datos de la cuenta IG y vista previa del media | `GET /{ig-user-id}?fields=username,followers_count`, `GET /{media-id}?fields=caption,permalink,media_url` | `instagram_basic` |
| Enviar / recibir WhatsApp | `POST /{phone-number-id}/messages` | `whatsapp_business_messaging` |
| Leer plantillas de WhatsApp (Marketing) | `GET /{waba-id}/message_templates` | `whatsapp_business_management` |

### Lista final de permisos, y en qué caso de uso vive cada uno

El panel de Meta agrupa los permisos por **caso de uso**, y un permiso que no
pertenece al caso de uso abierto simplemente no aparece en la lista — ni en
*Agregar más a este caso de uso*. Hay que abrir el caso de uso correcto:

| Caso de uso en el panel | Permisos a marcar |
| --- | --- |
| **Messenger from Meta** | `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list` |
| **API de Instagram** | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` |
| **Administrar todo en la página** (hay que agregarlo desde *Casos de uso → Agregar caso de uso*) | `pages_manage_engagement`, `pages_read_user_content` |
| **WhatsApp Business Platform** | `whatsapp_business_messaging`, `whatsapp_business_management` |

Si "Administrar todo en la página" no aparece en el catálogo de casos de uso,
agrega el caso de uso **"Otro"**: expone la lista completa de permisos sin el
filtro por caso de uso.

### Tres pares de permisos que se confunden

**`pages_read_engagement` vs `pages_read_user_content`** — hacen falta los dos: el
primero cubre el contenido que **publica tu página** (la vista previa del post en
el módulo Feed), el segundo el contenido que **escriben los usuarios** (el texto de
los comentarios). Comprobado contra Graph: con `pages_read_engagement` concedido y
`pages_read_user_content` sin conceder, `GET /me/posts` devuelve la publicación pero
`GET /{post-id}/comments` falla con
`(#10) This endpoint requires the 'pages_read_user_content' permission`.

**Instagram no funciona igual que Facebook aquí.** Leer los comentarios de una
publicación de Instagram (`GET /{media-id}/comments`) funciona con
`instagram_basic` a secas — no hay un equivalente de `pages_read_user_content`.
`instagram_manage_comments` solo hace falta para **responder**.

**`instagram_manage_comments` vs `instagram_manage_engagement`** — solo hace falta
el primero. Según la [referencia de permisos de Meta](https://developers.facebook.com/docs/permissions/),
`instagram_manage_comments` permite «crear, eliminar y ocultar comentarios», que es
lo que hace `POST /{comment-id}/replies`
([meta.ts:740-759](artifacts/api-server/src/lib/meta.ts#L740-L759)).
`instagram_manage_engagement` es para publicar o eliminar **«Me gusta»** en
publicaciones y comentarios — la app no da likes, y las reacciones entrantes se
ignoran a propósito.

**`pages_manage_engagement`** sí es necesario, y no es el equivalente del anterior:
en Facebook es el que autoriza publicar la respuesta pública al comentario
(`POST /{comment-id}/comments`).

### No mezcles las dos familias de permisos de Instagram

Meta tiene **dos** APIs de Instagram con permisos de nombre parecido:

| API | Permisos | Endpoints |
| --- | --- | --- |
| Instagram API con **Facebook Login** ← *la que usa esta app* | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments` | `graph.facebook.com`, token de página, `POST /me/messages` |
| Instagram API con **Instagram Login** | `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments` | `graph.instagram.com`, token propio de Instagram |

El código va por la primera: `graph.facebook.com/v21.0`
([meta.ts:7-8](artifacts/api-server/src/lib/meta.ts#L7-L8)), y para Instagram
usa el token de la cuenta o, si está vacío, el Page Access Token
([meta.ts:400](artifacts/api-server/src/lib/meta.ts#L400)).

Solicitar los `instagram_business_*` no aporta cobertura extra: obliga a
configurar y demostrar en el screencast una segunda integración que el producto
no tiene. Bórralos de la solicitud **y** del caso de uso (*personaliza los casos
de uso*) — la papelera de la pantalla de revisión solo los quita de la solicitud,
no de la app.

> Migrar a Instagram Login sería un proyecto aparte: cambia el host, el token, el
> flujo de autorización y el objeto del webhook. No lo mezcles con este review.

### `pages_utility_messaging`: quítalo de esta solicitud

Ese permiso sirve para enviar **plantillas de utilidad de Messenger** fuera de la
ventana de 24 h. La app no las usa: los envíos a Facebook e Instagram son
free-form con `messaging_type: "RESPONSE"`
([meta.ts:390-407](artifacts/api-server/src/lib/meta.ts#L390-L407),
[campaign-sender.ts:64-91](artifacts/api-server/src/lib/campaign-sender.ts#L64-L91)).

Consecuencias de dejarlo en la solicitud:

- Exige al menos **1 llamada de prueba** con ese permiso (es lo que te está
  bloqueando: *"0 de 1 llamadas de prueba a la API necesarias"*), y no hay
  código que la haga.
- Exige un screencast mostrando la administración de plantillas de utilidad, que
  el producto no tiene → rechazo probable, y un rechazo retrasa **toda** la
  solicitud, incluidos los permisos que sí necesitas.

Quítalo, aprueba primero el núcleo, y déjalo para una segunda solicitud si algún
día quieres notificaciones de Messenger fuera de las 24 h (requiere implementar
plantillas de utilidad, no basta el permiso).

> **Nota operativa relacionada:** hoy una campaña de Marketing a un contacto de
> FB/IG cuyo último mensaje tenga más de 24 h falla con el error #10 de Meta
> (*"outside of allowed window"*). Es el comportamiento esperado de la API, no un
> bug de la app.

### `Human Agent`: quítalo de esta solicitud

Human Agent no es un permiso sino una **función**, y aparece con su propia tarjeta
en *Uso permitido*. Sirve para responder hasta **7 días** después del último
mensaje del cliente, en lugar de 24 h, y solo cuando quien responde es una persona.
Para usarla hay que enviar con `messaging_type: "MESSAGE_TAG"` y `tag:
"HUMAN_AGENT"`.

La app **no la usa**: todos los envíos a Messenger e Instagram van con
`messaging_type: "RESPONSE"`
([meta.ts:451](artifacts/api-server/src/lib/meta.ts#L451),
[meta.ts:531](artifacts/api-server/src/lib/meta.ts#L531),
[meta.ts:767](artifacts/api-server/src/lib/meta.ts#L767)) — el tag no existe en
ninguna parte del código. Pedirla obliga a grabar un screencast de algo que el
producto no hace, con el mismo riesgo de rechazo en cascada que
`pages_utility_messaging`.

> **Vale la pena en una segunda solicitud.** Sin Human Agent, si un cliente
> escribe el viernes por la noche y un agente contesta el lunes, el envío falla
> con el error #10. Implementarla es acotado: usar `MESSAGE_TAG` + `HUMAN_AGENT`
> cuando el emisor es un agente humano **y** el último mensaje entrante tiene más
> de 24 h. Nunca en las campañas de Marketing — ahí sería una violación de
> política, el tag es solo para respuestas de una persona a una consulta.

### `pages_show_list` es obligatorio: Meta lo exige como dependencia

**No lo saques de la solicitud, aunque no se pueda demostrar dentro del
producto.** El panel lo exige como requisito de otros dos permisos que sí son el
núcleo del review, y lo dice en la propia tarjeta de *Uso permitido*:

> La solicitud debe contener `pages_show_list` para usar `pages_manage_engagement`
>
> La solicitud debe contener `pages_show_list` para usar `pages_manage_metadata`

Mientras falte, esas dos tarjetas no se completan y la solicitud no se puede
enviar. Son **11 permisos**, no 10.

Lo que sí es cierto es que la app no tiene selector de páginas —el Page ID se
escribe a mano
([MetaIntegrations.tsx:330](artifacts/omnicanal/src/components/settings/MetaIntegrations.tsx#L330))—
y que quien llama a `GET /me/accounts` es el administrador desde el Explorador de
la API Graph, durante el alta y al derivar el token permanente (sección 2). Eso no
es un problema, es simplemente lo que hay que grabar y describir: la descripción de
la sección 4 y el paso 6 del screencast están escritos para coincidir con eso. Lo
que se rechaza es prometer un selector de páginas que no existe, no usar el
Explorador.

> Si algún día se agrega un selector de páginas real en *Conexión con Meta*, este
> permiso pasa a demostrarse dentro del producto y habría que reescribir su
> descripción.

---

## 2. Un Page Access Token con todos los scopes

El token que genera el panel de Messenger **solo trae los permisos de
mensajería**. Para las llamadas de prueba de comentarios, para el screencast del
módulo Feed y para que ese módulo funcione en producción hace falta un token que
incluya además los de lectura y respuesta de comentarios.

**Para probar (rápido, caduca en ~1 h):** en el Explorador de la API Graph,
genera un **token de usuario** con estos scopes marcados…

```
pages_show_list            pages_messaging
pages_manage_metadata      pages_read_engagement
pages_read_user_content    pages_manage_engagement
instagram_basic            instagram_manage_messages
instagram_manage_comments
```

…y luego pide el token de la página, que hereda esos scopes:

```
GET /me/accounts?fields=name,access_token
```

El `access_token` que viene en la fila de tu página es el Page Access Token con
todos los permisos.

> ⚠ Ese token caduca cuando caduca el token de usuario del Explorador (una o dos
> horas). Sirve para las pruebas, **no** para dejarlo guardado en la app.

### Para producción: un page token que no expira

La app **necesita un Page Access Token**, no un token de usuario: envía los
mensajes con `POST /me/messages`
([meta.ts:394](artifacts/api-server/src/lib/meta.ts#L394)), y `/me` solo resuelve
a la página cuando el token es de la página. Con un token de usuario (incluido el
de un usuario del sistema) `/me` resuelve al usuario y el envío falla. El test de
*Probar conexión* rechaza de entrada cualquier token cuyo tipo no sea `PAGE`.

El truco para que no expire es **de dónde se deriva**: un page token obtenido a
partir de un **usuario del sistema** hereda su carácter permanente, mientras que
uno obtenido desde un token de usuario normal caduca con él.

1. `business.facebook.com` → **Configuración del negocio → Usuarios → Usuarios
   del sistema** → *Agregar*. Rol: administrador del sistema.
2. **Asignar activos** a ese usuario, con control total:
   - *Cuentas → Páginas* → la página
   - *Cuentas → Cuentas de Instagram* → la cuenta profesional
   - *Cuentas → Cuentas de WhatsApp* → la WABA
   - *Apps* → la app de Meta
3. **Generar nuevo token** → elige la app → marca los scopes de la lista de
   arriba (más los dos de WhatsApp) → copia el token. **Este todavía no es el que
   va en la app.**
4. Con ese token, pide el de la página:

   ```
   GET /me/accounts?fields=name,access_token
   ```

   El `access_token` de la fila de tu página es el Page Access Token permanente.
5. Ese último es el que va en *Configuración → Conexión con Meta*, en el campo
   **Page Access Token**. Puedes dejar vacío el de Instagram: la app cae al de la
   página ([meta.ts:400](artifacts/api-server/src/lib/meta.ts#L400)).
6. *Probar conexión* debe responder `Token: tipo PAGE, no expira`. Si dice que
   expira en una fecha, el token de origen no era de un usuario del sistema.

---

## 3. Antes de la solicitud: las llamadas de prueba

Meta exige ≥1 llamada exitosa por permiso antes de dejarte enviar. Se hacen desde
**Herramientas → Explorador de la API Graph**, con la app `Decolor By NICADOM`
seleccionada, generando un token de usuario con los permisos marcados. Tardan
hasta 24 h en reflejarse en el panel.

```
# pages_show_list  → también te devuelve el Page Access Token
GET /me/accounts?fields=id,name,access_token

# pages_manage_metadata  (además deja la página realmente suscrita al webhook)
POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed

# pages_read_engagement
GET /{page-id}?fields=name,fan_count
GET /{page-id}/posts?fields=id,message,permalink_url

# pages_messaging  → escribe primero a la página desde tu Facebook personal,
# copia tu PSID del log del webhook y responde:
POST /me/messages
  { "recipient": {"id": "<PSID>"}, "messaging_type": "RESPONSE",
    "message": {"text": "Prueba de Decolor Pro"} }

# pages_read_user_content  (comentarios escritos por usuarios en tu post)
GET /{post-id}/comments?fields=id,message,from,created_time

# pages_manage_engagement  (usa el id de un comentario real en un post tuyo)
POST /{comment-id}/comments   { "message": "Gracias por escribirnos" }

# instagram_basic
GET /{page-id}?fields=instagram_business_account
GET /{ig-user-id}?fields=username,name,followers_count

# instagram_manage_comments
GET /{ig-media-id}/comments
POST /{ig-comment-id}/replies   { "message": "Te escribimos por DM" }

# instagram_manage_messages  → envíate un DM a la cuenta desde otra cuenta IG
POST /me/messages
  { "recipient": {"id": "<IGSID>"}, "message": {"text": "Prueba de Decolor Pro"} }
```

`{page-id}`, `{ig-user-id}` y los tokens son los mismos valores que pegas en
*Configuración → Conexión con Meta*.

---

## 4. Textos para el App Review (copiar y pegar)

Meta pide, por permiso: descripción del uso + valor para el usuario + screencast.
Estos textos describen el producto tal como está implementado — no prometas nada
que el screencast no muestre.

> ⚠ Van con `>` porque aquí son citas de Markdown. **No pegues los `>` en el
> panel de Meta**, y revisa que el texto empiece por la primera palabra y no a
> mitad de la primera línea. Al final de cada uno, agrega el minuto del screencast
> donde se ve ese permiso en acción.

### Ignora el botón *AI Content Suggestion*

El panel ofrece un texto generado por permiso, con un botón *Use This*. **No lo
uses.** Parafrasea la descripción completa del permiso —la que aparece en gris
justo debajo— en vez de describir la app, así que te hace prometer todo lo que el
permiso permite hacer, no lo que tú haces.

En la tarjeta de `whatsapp_business_messaging`, por ejemplo, afirmaba que la app
registra números de teléfono con Meta y administra información del perfil de
empresa. Ninguna de las dos es cierta: en WhatsApp la app solo llama a
`POST /{phone-number-id}/messages`, `POST /{phone-number-id}/media`
([meta.ts:640](artifacts/api-server/src/lib/meta.ts#L640)), `GET /{media-id}`
([meta.ts:294](artifacts/api-server/src/lib/meta.ts#L294)) y
`GET /{waba-id}/message_templates`. Prometer capacidades que el screencast no
muestra es la vía rápida al rechazo.

**`pages_messaging`**

> Decolor By NICADOM es la plataforma de atención al cliente omnicanal de nuestra
> tienda de pinturas y ferretería. Usamos `pages_messaging` para recibir en
> nuestra bandeja unificada los mensajes que los clientes nos envían por Messenger
> a nuestra página, y para responderlos: primero un agente virtual que contesta
> consultas de catálogo, precios y disponibilidad con nuestra base de conocimiento,
> y luego un agente humano de nuestro equipo que continúa la conversación cuando el
> caso lo requiere. También usamos Respuestas privadas (`recipient.comment_id`) para
> continuar en privado una conversación que empezó como comentario público en
> nuestra página. Valor para las personas: reciben respuesta inmediata a cualquier
> hora en el canal que ya usan, sin repetir su consulta ni cambiar de aplicación.
> Todos los envíos son respuestas a mensajes iniciados por el cliente dentro de la
> ventana permitida.

**`pages_manage_metadata`**

> Lo usamos para suscribir nuestra app a los webhooks de nuestra propia página
> (`messages`, `feed`) mediante `POST /{page-id}/subscribed_apps`, una sola vez
> durante la configuración inicial. Sin esa suscripción la plataforma no recibe los
> mensajes ni los comentarios de los clientes y no puede responderlos. Después, la
> pantalla de configuración usa `GET /{page-id}/subscribed_apps` cada vez que el
> administrador pulsa *Probar conexión*, para mostrarle a qué campos está suscrita
> la página y avisarle si la suscripción se perdió — que es la causa más común de
> que dejen de llegar los mensajes de los clientes. No modificamos ninguna otra
> configuración de la página.

**`pages_read_engagement`**

> Leemos los metadatos de la publicación de nuestra propia página que un cliente
> comentó (texto, enlace permanente e imagen) para mostrar en el módulo Feed el
> contexto de la publicación junto al hilo de comentarios. Así el agente que
> responde ve de qué producto o promoción se está hablando antes de contestar.
> Solo leemos publicaciones de la página que administramos.

**`pages_read_user_content`**

> Leemos el contenido de los comentarios que los clientes escriben en las
> publicaciones de nuestra propia página, que es lo que recibimos por el webhook
> `feed`, para mostrarlos en la bandeja del módulo Feed y que un agente pueda
> responderlos. Sin este permiso el equipo no puede ver qué preguntó el cliente.
> Solo leemos comentarios en publicaciones de la página que administramos.

**`pages_manage_engagement`**

> Publicamos respuestas públicas a los comentarios de los clientes en las
> publicaciones de nuestra página, desde la misma bandeja unificada donde el
> equipo atiende los mensajes privados (`POST /{comment-id}/comments`). Valor para
> las personas: quien pregunta por un precio o por la disponibilidad de un producto
> en un comentario recibe la respuesta ahí mismo, en público, en minutos, y el
> resto de los interesados también la ve. Solo comentamos en publicaciones de
> nuestra propia página.

**`pages_show_list`**

> Durante el alta de la plataforma, el administrador de la tienda consulta con
> `GET /me/accounts` la lista de páginas que administra, para identificar cuál se
> va a conectar y obtener su Page Access Token, que luego guarda en la pantalla de
> configuración de la plataforma. Se usa solo en ese momento y cuando hay que
> renovar el token de la página; la aplicación no consulta la lista de páginas
> durante su funcionamiento normal.

**`instagram_basic`**

> Leemos el nombre de usuario y los datos públicos básicos de nuestra propia
> cuenta profesional de Instagram para confirmar en la pantalla de configuración
> que la cuenta conectada es la correcta, y los metadatos de nuestras publicaciones
> (pie de foto, enlace permanente e imagen) para mostrar el contexto de la
> publicación junto al hilo de comentarios que el equipo va a responder.

**`instagram_manage_messages`**

> Usamos `instagram_manage_messages` para recibir en nuestra bandeja unificada los
> mensajes directos que los clientes envían a nuestra cuenta profesional de
> Instagram y responderlos: un agente virtual contesta consultas de catálogo,
> precios y disponibilidad con nuestra base de conocimiento, y un agente humano de
> nuestro equipo continúa la conversación cuando hace falta. Valor para las
> personas: respuesta inmediata en el canal que eligieron, con el mismo historial y
> el mismo equipo que atiende WhatsApp y Messenger. Todos los envíos responden a
> mensajes iniciados por el cliente dentro de la ventana permitida.

**`instagram_manage_comments`**

> Recibimos los comentarios que los clientes dejan en las publicaciones de nuestra
> cuenta profesional de Instagram y respondemos públicamente en el mismo hilo
> (`POST /{comment-id}/replies`), desde la bandeja unificada del equipo de
> atención. Valor para las personas: la pregunta sobre un producto se responde en
> el mismo lugar donde la hicieron y sin esperas. Solo leemos y respondemos
> comentarios en publicaciones de nuestra propia cuenta.

**Descripción del negocio** — campo extra que pide la tarjeta de
`whatsapp_business_messaging`. Es sobre el negocio, no sobre el permiso, y de una
sola línea:

> Somos Decolor by NICADOM, una cadena de tiendas de pinturas, acabados y
> ferretería en República Dominicana, donde asesoramos a nuestros clientes y les
> formulamos colores a medida; usamos esta plataforma únicamente para atender a
> nuestros propios clientes por WhatsApp, Messenger e Instagram.

Lo que no puede faltar es **"nuestros propios clientes"**: es lo que distingue a un
comercio atendiendo su propia clientela de un proveedor de software o un BSP, que
es otra categoría con otros requisitos. Va en la misma línea que el resto de las
descripciones, donde siempre se dice *nuestra propia página* / *nuestra propia
cuenta*.

**`whatsapp_business_messaging`**

> Recibimos en nuestra bandeja unificada los mensajes de WhatsApp que los clientes
> envían a nuestro número de WhatsApp Business —incluidos los adjuntos y las notas
> de voz, que descargamos para que el agente pueda verlos y escucharlos— y los
> respondemos: primero un agente
> virtual que contesta consultas de catálogo, precios y disponibilidad con nuestra
> base de conocimiento, y luego un agente humano de nuestro equipo cuando el caso lo
> requiere. Las respuestas a una conversación van dentro de la ventana de atención
> al cliente; los envíos de marketing usan plantillas aprobadas y solo se hacen a
> clientes que dieron su consentimiento. Valor para las personas: resuelven su
> compra por el canal que ya usan todos los días, con respuesta inmediata a
> cualquier hora y sin repetir su consulta si pasa a un agente humano.

**`whatsapp_business_management`**

> Leemos el catálogo de plantillas de mensaje ya aprobadas de nuestra propia WABA
> (`GET /{waba-id}/message_templates`) para que el administrador de la tienda elija
> una de la lista al preparar un envío a clientes que dieron su consentimiento, y
> para que la plataforma sepa qué variables lleva cada plantilla y las complete
> correctamente. Es solo lectura: la app no crea, edita ni elimina plantillas — esas
> se gestionan desde el Administrador de WhatsApp. Sin este permiso el administrador
> tendría que escribir a mano el nombre y el idioma exactos de la plantilla, con el
> error que eso implica.

---

## 5. Screencast (uno solo puede cubrir varios permisos)

**Se graba la app web** (`artifacts/omnicanal`) en producción, no la app móvil: el
revisor no va a instalar nada, y todo lo que hay que demostrar está en el
navegador.

Reglas que hacen que un video se rechace sin leer el resto de la solicitud:

- Navegador completo y **URL visible** todo el tiempo. Nada de grabar solo la
  ventana o recortar la barra de direcciones.
- Datos reales, sin cortes ni acelerado dentro de una misma demostración.
- **El audio es opcional**, y mudo es la mejor opción aquí: la interfaz está en
  español y el revisor lee en inglés, así que narrar obligaría a subtitular. Pero
  mudo exige **rótulos de texto en pantalla, en inglés**, uno por tramo, diciendo
  qué permiso se está demostrando. El revisor no puede adivinar qué mira.
- Detente **2-3 segundos** en cada pantalla clave —el resultado de *Probar
  conexión*, el texto del comentario en el Feed— antes de seguir. Si pasas rápido,
  el permiso se da por no demostrado. Y mueve el ratón despacio: sin narración, el
  cursor es lo único que guía la mirada.
- **No hace falta difuminar los tokens.** La API nunca devuelve una credencial
  completa al navegador — solo la vista enmascarada `••••XXXX`
  ([settings.ts:34-37](artifacts/api-server/src/routes/settings.ts#L34-L37)). La
  nota de cumplimiento que aparece al pie de esa pantalla juega a tu favor:
  déjala visible un par de segundos.

### Guion

1. **Login** en `https://<dominio>/login` con la cuenta de prueba, y de ahí a
   *Configuración → Conexión con Meta*.

   Esta pantalla sola demuestra dos permisos en vivo, así que no la pases rápido:

   - *Probar conexión* en la tarjeta de **Facebook** → el resultado dice
     `Webhook suscrito a: messages, feed`. Ese texto sale de un
     `GET /{page-id}/subscribed_apps`, que es una llamada que **requiere
     `pages_manage_metadata`**
     ([settings.ts:316-328](artifacts/api-server/src/routes/settings.ts#L316-L328)).
   - *Probar conexión* en la tarjeta de **Instagram** → responde
     `Cuenta conectada: @usuario`, de un
     `GET /{ig-user-id}?fields=username,name,followers_count` que **requiere
     `instagram_basic`**
     ([settings.ts:368-369](artifacts/api-server/src/routes/settings.ts#L368-L369)).

2. **DM de Messenger** (`pages_messaging`): desde un teléfono, escríbele a la
   página. En *Bandeja Unificada* (`/inbox`) se ve entrar el mensaje, responde el
   agente virtual, y después un agente humano escribe desde la app y el cliente lo
   recibe en el teléfono.
3. **DM de Instagram** (`instagram_manage_messages`): lo mismo desde Instagram, en
   la misma bandeja — que se note que es una sola lista para los tres canales.
4. **Comentario en Facebook** (`pages_read_engagement` + `pages_read_user_content`
   + `pages_manage_engagement`): comenta en una publicación de la página → aparece
   en *Feed de Publicaciones* (`/feed`) con la vista previa del post → responde en
   público desde la app → se ve la respuesta publicada en Facebook.
5. **Comentario en Instagram** (`instagram_manage_comments`): igual, en una
   publicación de Instagram.
6. **Mensaje de WhatsApp** (`whatsapp_business_messaging`): desde el teléfono,
   escribe al número de WhatsApp Business. Entra en la misma bandeja, responde el
   agente virtual y luego el agente humano. **Manda también una nota de voz o una
   foto**: la descripción de ese permiso menciona los adjuntos, y aquí es donde se
   ven (la app los descarga con `GET /{media-id}` y el agente los abre en la
   bandeja).
7. **Plantillas de WhatsApp** (`whatsapp_business_management`): entra a *Marketing*
   (`/campaigns`) → nueva campaña de WhatsApp → el desplegable **«Plantilla
   aprobada de Meta»** se llena con las plantillas reales de la WABA
   ([campaigns.tsx:531-551](artifacts/omnicanal/src/pages/campaigns.tsx#L531-L551)).
   Ese desplegable poblándose **es** la demostración del permiso: sale de
   `GET /{waba-id}/message_templates`. Elige una y que se vean los campos de
   variables que aparecen debajo. No hace falta enviar la campaña.
8. **`pages_show_list`** — el único que no ocurre dentro de la app, porque no hay
   selector de páginas. Grábalo como lo que es, el alta de la integración:
   Explorador de la API Graph con **la app seleccionada** →
   `GET /me/accounts?fields=name,access_token` → se ve la página en la respuesta →
   copias el Page ID y el token y los pegas en *Configuración → Conexión con Meta*
   → *Probar conexión* en verde. Sale natural si lo pones al principio del video,
   antes del paso 1, porque es literalmente el orden real de la configuración.

---

## 6. La pantalla de envío del review

La solicitud se completa en cinco pestañas: *Verificación*, *Configuración de la
app*, *Uso permitido*, *Tratamiento de datos* e *Instrucciones para revisores*. No
se envía hasta que las cinco están en verde.

### Antes de tocar nada: recorta la solicitud

*Uso permitido* muestra una tarjeta por cada permiso **y por cada función**
pedida, y cada tarjeta exige descripción + screencast + confirmación. Todo lo que
la app no hace es trabajo extra y riesgo de rechazo. Quita `pages_utility_messaging`,
`Human Agent` y los `instagram_business_*` — las tres razones están en la sección
1 — **antes** de empezar a llenar tarjetas: cada tarjeta que borres es una menos
que justificar. Quedan **11 permisos**.

Cuidado con recortar de más: las tarjetas avisan cuando un permiso depende de
otro (*"la solicitud debe contener X para usar Y"*). `pages_show_list` es
dependencia de `pages_manage_engagement` y `pages_manage_metadata`, así que va
sí o sí.

La papelera de la pantalla de revisión los quita de la solicitud pero **no** del
caso de uso; para eso está el enlace *personaliza los casos de uso* al pie de esa
misma pantalla.

### Uso permitido

Una tarjeta por permiso, siempre con los mismos tres pasos:

1. **Describe cómo tu app usa este permiso** → los textos de la sección 4, tal
   cual.
2. **Sube una captura de video** → el mismo screencast de la sección 5 sirve para
   todas las tarjetas, pero hay que subirlo en cada una. En la descripción de cada
   tarjeta conviene indicar el minuto donde se ve ese permiso en acción; es lo que
   más acelera la revisión.
3. **Confirma que cumplirás con el uso permitido** → casilla.

#### La tarjeta de `pages_messaging` pide dos cosas más

Es la excepción: además de lo anterior trae un bloque *«Prueba y reproduce la
funcionalidad de tu integración»*, con un selector de página y una caja de
instrucciones paso a paso. El revisor las va a seguir al pie de la letra, así que
tienen que funcionar sin conocer el producto.

Y trae una nota que es un requisito aparte, fácil de pasar por alto:

> Crea una cuenta **real** en Facebook y otórgale el rol de evaluador en *Roles de
> la app*. **No** envíes un usuario de prueba creado en *Roles de la app*: esos no
> pueden recibir mensajes de bots.

O sea que hacen falta **dos** cuentas de prueba distintas, y no sirve la misma
para las dos cosas:

| Cuenta | Para qué | Dónde se crea |
| --- | --- | --- |
| Cuenta de Facebook real con rol **Evaluador** | Que el revisor le escriba a la página desde Messenger y reciba respuesta estando el permiso todavía en acceso estándar | Facebook + *Roles de la app → Evaluadores* |
| Agente humano con rol `admin` en la plataforma | Que el revisor entre a la bandeja y responda como agente | *Agentes*, dentro de la app |

Cómo se prepara la de Facebook:

1. Una cuenta **normal** de Facebook, con correo o teléfono verificado. No sirve un
   usuario de *Roles de la app → Usuarios de prueba*.
2. *Roles de la app → Roles → Agregar personas → **Evaluador***, e invítala.
3. **Acepta la invitación desde esa cuenta** — en `developers.facebook.com`. El rol
   no existe hasta que se acepta, y hasta entonces la cuenta se comporta igual que
   una sin rol: escribe a la página y no recibe respuesta. Es el error que más
   tiempo hace perder buscándolo en el código.
4. Compruébalo tú: con esa cuenta, abre el enlace `m.me` y escribe. Si responde el
   agente virtual, está lista.

> Facebook bloquea con frecuencia las cuentas recién creadas que solo se usan para
> esto. Mejor una cuenta secundaria que ya exista y tenga actividad; si la creas
> nueva, hazlo con días de antelación. Una cuenta bloqueada a mitad de la revisión
> es un rechazo. Y graba el screencast desde ella: se ve el punto de vista de un
> cliente, no el del administrador de la página.

**Esa cuenta se entrega con usuario y contraseña**: el revisor inicia sesión con
ella y prueba como un cliente cualquiera. De ahí salen dos condiciones que se
pasan por alto hasta que el revisor reporta "las credenciales no funcionan":

- **Sin verificación en dos pasos.** El código de 2FA te llegaría a ti, no al
  revisor.
- **Que no le salte el checkpoint de identidad.** El revisor entra desde otro país
  y otro dispositivo, así que Facebook lo trata como acceso sospechoso. Una cuenta
  con foto, algunos amigos y actividad real pasa; una cuenta vacía de ayer casi
  siempre recibe el "confirma que eres tú" y ahí se acaba la prueba.

Las credenciales van en los **campos de credenciales de prueba** de la pestaña
*Instrucciones para revisores*, no dentro de la caja de pasos: en los pasos basta
con referirse a *"the test account we provided"*.

Texto para la caja de instrucciones, ajustando el dominio y el id de la página:

> 1. Sign in to Facebook with the test account we provided, then open
>    `https://m.me/<page-id>` and send a message such as
>    "Hi, what paint colors do you have?".
> 2. Within a few seconds our virtual agent replies with information from our
>    product catalog. This is the inbound message arriving through the `messages`
>    webhook and our reply through `POST /me/messages`.
> 3. To see how a human agent takes over, open `https://<dominio>/login` and sign
>    in with the platform test credentials we provided.
> 4. Go to *Bandeja Unificada* (Unified Inbox). The conversation from step 1 is at
>    the top of the list, tagged as a Messenger conversation.
> 5. Open it. You will see the full history. Type a reply in the message box and
>    send it.
> 6. The reply arrives in Messenger on the account from step 1.

Está en inglés a propósito: son instrucciones que el revisor ejecuta literalmente,
y ahí una mala traducción cuesta un rechazo. Las descripciones de la sección 4
pueden ir en español sin problema.

> **La página de Decolor no tiene nombre de usuario** — su URL es
> `facebook.com/profile.php?id=<page-id>`. El enlace `m.me` funciona igual con el
> ID en lugar del usuario (`https://m.me/<page-id>`); compruébalo en una ventana
> privada antes de pegarlo. Si no resolviera, pon la URL de la página y dile al
> revisor que use el botón *Enviar mensaje*.

Y en el mensaje de ejemplo del paso 1, no uses un saludo suelto. Un `hola` prueba
que hay un bot, pero no prueba **valor**, que es lo que Meta pide justificar. Una
pregunta de producto real —precio, disponibilidad, un color concreto— hace que el
agente responda con el catálogo, y eso sí se defiende solo.

### Tratamiento de datos

Aquí Meta pregunta qué pasa con los datos de las personas después de recibirlos.
Lo que hay que declarar en este producto, porque es lo que hace el código:

| Dato | Dónde va | Para qué |
| --- | --- | --- |
| Mensajes, nombre e id de usuario (PSID / IGSID) | Base de datos de la plataforma (Postgres) | Historial de la conversación en la bandeja unificada |
| Texto del mensaje | **OpenAI** ([openai-client.ts](artifacts/api-server/src/lib/openai-client.ts)) | Generar la respuesta del agente virtual |
| Audio de las notas de voz | **OpenAI** (Whisper) | Transcribir el audio para que el agente lo lea |
| Adjuntos (imágenes, audio) | **Supabase Storage** ([supabase.ts](artifacts/api-server/src/lib/supabase.ts)) | Guardar el archivo del mensaje |

OpenAI y Supabase son **proveedores de servicio** (subencargados del tratamiento),
no terceros que reciban los datos para su propio uso: no hay venta de datos, ni
publicidad, ni enriquecimiento de perfiles. Declararlos así es lo correcto —
omitirlos es lo que se considera una declaración falsa.

### Instrucciones para revisores

El revisor es una persona que va a intentar reproducir el screencast. Necesita
entrar a la app, y **no** hay que darle `ADMIN_EMAIL` / `ADMIN_PASSWORD`: crea en
*Agentes* un agente humano con rol `admin`, activo y con contraseña propia
([auth.ts:47-77](artifacts/api-server/src/routes/auth.ts#L47-L77)). Se borra
cuando termine la revisión, y su actividad queda separada de la del administrador
real.

Texto para la pestaña, ajustando la URL y las credenciales:

> Decolor By NICADOM es una plataforma privada de atención al cliente de nuestra
> tienda de pinturas y ferretería. No es una app pública: solo la usa nuestro
> equipo interno, y atiende únicamente los mensajes de nuestra propia página de
> Facebook, nuestra cuenta profesional de Instagram y nuestro número de WhatsApp
> Business.
>
> 1. Entra a `https://<dominio>/login` con el correo y la contraseña de prueba de
>    más abajo.
> 2. En *Bandeja* verás las conversaciones de los tres canales en una sola lista.
>    Abre una conversación de Messenger o de Instagram: se ve el historial, la
>    respuesta del agente virtual y el cuadro para que un agente humano escriba.
> 3. En *Feed* verás los comentarios de las publicaciones de nuestra página y de
>    nuestra cuenta de Instagram, con la vista previa de la publicación y el cuadro
>    para responder en público.
> 4. En *Configuración → Conexión con Meta* está la pantalla donde el
>    administrador conecta la página y la cuenta de Instagram, con el botón
>    *Probar conexión*.
>
> Para ver un mensaje entrar en vivo, escribe un mensaje a nuestra página desde tu
> Facebook: aparece en *Bandeja* en pocos segundos y el agente virtual responde.

### Dónde va cada credencial

Meta da **un solo par** de campos de credenciales de prueba, y tú tienes dos
cuentas que entregar (ver la tabla de más arriba). El reparto:

- **Campos de credenciales de prueba** → el agente de la plataforma. Esos campos
  son para iniciar sesión en *tu* app.
- **Caja de instrucciones**, escritas y etiquetadas → la cuenta de Facebook con rol
  Evaluador, para que no se confundan con las anteriores.

Encabezado sugerido para la caja:

> **Platform (our app)** — sign in at `https://<dominio>/login`
> Email: `…` · Password: `…`
> *(same credentials as in the test-credentials fields above)*
>
> **Facebook test account** — has the Tester role in our app; use it to message our
> Page
> Email: `…` · Password: `…`

El agente de la plataforma se crea en *Agentes* → usuario **humano**, rol
**Administrador**, contraseña de 8 caracteres o más
([agent-editor.tsx:292](artifacts/omnicanal/src/pages/agent-editor.tsx#L292)).
Tiene que ser administrador y no agente: *Feed de Publicaciones* y *Configuración*
son rutas de admin ([App.tsx:90-91](artifacts/omnicanal/src/App.tsx#L90-L91)) y el
revisor necesita entrar a las dos.

> Con ese rol el revisor ve conversaciones reales de clientes y puede tocar la
> configuración. Es inevitable —el screencast también las muestra— pero por eso la
> cuenta se borra en cuanto llegue la aprobación, y por eso no se entrega el
> `ADMIN_PASSWORD` del entorno.

Deja la app **en modo Activo** mientras dure la revisión: si la pasas a Desarrollo,
el revisor no puede probar nada y la solicitud se rechaza.

---

## 7. Webhooks

**URL de callback:** `https://<tu-dominio>/api/webhooks/meta`
(la app te la muestra ya armada y con botón de copiar en *Configuración → Conexión
con Meta*).

**Verify token:** el que escribas en ese mismo formulario. Guarda **antes** de
verificar en Meta — el handshake lo compara contra la base de datos
([webhooks.ts:24-45](artifacts/api-server/src/routes/webhooks.ts#L24-L45)).

> **En el panel nuevo no existe la entrada *Webhooks* del menú.** Esta app usa la
> navegación por **casos de uso**, y los webhooks se configuran **dentro de cada
> caso de uso**: *Casos de uso → \<el que sea\> → Personalizar → Webhooks*. Ahí
> está la trampa que cuesta una tarde: `messages` se suscribe desde *Interactuar
> con los clientes en Messenger from Meta*, pero **`feed` vive en *Administrar
> todos los aspectos de tu página***, el caso de uso que se agrega por
> `pages_manage_engagement` y `pages_read_user_content`. Si solo configuraste el de
> Messenger, los DMs entran y los comentarios no.

Campos a suscribir por objeto (son los únicos que la app procesa hoy):

| Objeto | Campos |
| --- | --- |
| `whatsapp_business_account` | `messages` |
| `page` | `messages` · `feed` (solo si vas a usar el módulo Feed) |
| `instagram` | `messages` · `comments` (solo para el módulo Feed) |

**No suscribas `messaging_postbacks`.** El parser lee únicamente
`entry.messaging[].message`, y los taps de quick reply llegan dentro de ese mismo
evento como `message.quick_reply`
([meta.ts:148-166](artifacts/api-server/src/lib/meta.ts#L148-L166)). No existe una
rama para `ev.postback`, así que ese campo solo genera entradas
`webhook produced no inbound events` en el log. Si algún día se agregan botones de
postback (menú persistente, plantillas), habrá que implementar el handler primero.

Después de verificar la URL, la página debe quedar **suscrita a la app** (paso
que no se hace solo): *Casos de uso → Messenger → Configuración*, o
`POST /{page-id}/subscribed_apps` como en la sección 3.

La firma `X-Hub-Signature-256` se valida con el App Secret guardado en la app
([meta.ts:13-25](artifacts/api-server/src/lib/meta.ts#L13-L25)). Si el App Secret
está vacío la validación se omite (modo desarrollo) — **guárdalo antes de salir a
producción**.

---

## 8. Requisitos de las cuentas

**Facebook**
- Página de Facebook, y el usuario que autoriza debe ser administrador.
- Page Access Token: idealmente un **token de sistema** del Business Manager (no
  expira). Un token de usuario de 60 días obliga a rotarlo a mano.

**Instagram** — tres cosas que suelen ser la causa de "no llegan los DMs":
1. La cuenta debe ser **profesional** (Empresa o Creador), no personal.
2. Debe estar **vinculada a la página de Facebook** (verifícalo con
   `GET /{page-id}?fields=instagram_business_account`).
3. En la app de Instagram: **Configuración → Mensajes y respuestas de la historia
   → Herramientas de terceros → "Permitir el acceso a los mensajes"** debe estar
   activado. Sin esto los webhooks de DM nunca llegan, aunque los permisos estén
   aprobados.

El `Instagram Business Account ID` que pide la app es el que devuelve
`GET /{page-id}?fields=instagram_business_account` (empieza con `1784...`), **no**
el nombre de usuario ni el id numérico del perfil público.

Para Instagram el token puede quedar vacío: la app cae al Page Access Token
([meta.ts:400](artifacts/api-server/src/lib/meta.ts#L400)).

---

## 9. Checklist para publicar la app ("Sin publicar" → publicada)

- [ ] **Configuración básica**: icono 1024×1024, categoría, correo de contacto.
- [ ] **URL de la política de privacidad** — obligatoria. Debe ser pública y
      describir qué datos de Meta se guardan (mensajes, nombre, id de usuario) y
      por cuánto tiempo.
- [ ] **URL de las condiciones del servicio**.
- [ ] **Eliminación de datos de usuario** — obligatoria. Dos opciones:
      *Instrucciones de eliminación de datos* (una página web que explique cómo
      pedir la eliminación; es la vía rápida y no requiere código) o *Callback de
      eliminación de datos* (endpoint que valide el `signed_request`; **hoy no
      existe en el repo**).
- [ ] **Verificación del negocio** completada en el Business Manager — requisito
      para el acceso avanzado a `pages_messaging` e `instagram_manage_messages`.
- [ ] **App Review aprobado** para los 11 permisos de la sección 1.
- [ ] **Solicitud recortada**: sin `pages_utility_messaging`, sin `Human Agent` y
      sin los `instagram_business_*`, tanto en la solicitud como en los casos de
      uso. `pages_show_list` **sí va** — Meta lo exige.
- [ ] **Cuenta de prueba para el revisor** creada en *Agentes* (agente humano con
      rol `admin`) y pegada en *Instrucciones para revisores* — nunca las
      credenciales del administrador (sección 6).
- [ ] **Cuenta de Facebook real con rol Evaluador** creada y entregada, para la
      tarjeta de `pages_messaging` (sección 6). No vale un usuario de prueba.
- [ ] **App en modo Activo** mientras dure la revisión.
- [ ] **Casos de uso** configurados: Messenger, Instagram y WhatsApp, cada uno con
      su página / cuenta / número conectados.
- [ ] Webhook verificado **y** página suscrita.
- [ ] App Secret guardado en *Configuración → Conexión con Meta*.
- [ ] `OMNICANAL_SESSION_SECRET` definido en el servicio del sitio, y `ADMIN_EMAIL` y
      `ADMIN_PASSWORD` si alguien entra sin la cuenta del sitio (ver [PREMIER.md](PREMIER.md)).

---

## 10. Diagnóstico rápido

| Síntoma | Causa habitual |
| --- | --- |
| Handshake del webhook devuelve 403 | El verify token no se guardó en la app, o no coincide. El log dice `webhook handshake rejected` con `tokenConfigured`. |
| `webhook signature verification failed` | El App Secret guardado no es el de la app que envía el evento. |
| `webhook produced no inbound events` | Llega un tipo de evento que la app no procesa (status, reacción, eco). El log incluye el body completo. |
| No llegan DMs de Instagram | "Permitir el acceso a los mensajes" desactivado en la app de Instagram, o la página no está suscrita. |
| No llegan comentarios de Facebook | Falta el campo `feed` en la suscripción de la página — *Probar conexión* lo dice: `Webhook suscrito a: …`. Solo llegan los comentarios nuevos, el anterior no se recupera. |
| El evento de prueba del panel llega, pero **ningún** evento real | La app está **Sin publicar**. Mientras lo esté, Meta solo entrega los webhooks de prueba del panel — ni siquiera los de administradores o evaluadores. Publica la app (sección 0). |
| El evento de prueba del panel llega, pero los comentarios reales no | Son **dos suscripciones distintas**. `subscribed_apps` es la de la *página*; además, en *Webhooks → objeto Página* el campo `feed` tiene que estar suscrito para la **app**. Eso último no se configura desde *Messenger → Configuración*, donde `feed` ni aparece. Y el botón *Probar* manda el ejemplo aunque el campo no esté suscrito: solo prueba la URL, no la suscripción. |
| El evento de prueba del panel dice `webhook produced no inbound events` | Correcto, no es un fallo: el payload de ejemplo de Meta trae `item: "status"` (simula una publicación), y el parser solo procesa `item: "comment"` con `verb: "add"` ([meta.ts:200](artifacts/api-server/src/lib/meta.ts#L200)). |
| El comentario llega al webhook pero no aparece en *Feed* | Lo escribiste **como la página**. La app descarta esos eventos a propósito ([meta.ts:210](artifacts/api-server/src/lib/meta.ts#L210)): son el eco de sus propias respuestas por API. Comenta desde una cuenta personal. |
| El comentario aparece en *Feed* pero nadie responde | Otro problema, no el webhook. La respuesta automática necesita el hilo abierto, un agente virtual activo para el canal ([feed.ts:137](artifacts/api-server/src/lib/feed.ts#L137)) y OpenAI configurado — el log dice `feed reply skipped: OpenAI not configured`. |
| Error #10 al enviar campaña a FB/IG | Fuera de la ventana de 24 h — ver la nota de la sección 1. |
| Respuesta privada a un comentario falla | Solo se permite **una** por comentario y dentro de los 7 días. |
| Todo funcionaba y dejó de funcionar a los ~60 días | Page Access Token de usuario expirado; cámbialo por un token de sistema. |
| `(#100) … requires the 'pages_read_engagement' permission` | El token del panel de Messenger no trae ese permiso. **No afecta a la mensajería**; solo a la vista previa del módulo Feed. |
| `(#200) Requires pages_manage_metadata permission` | Igual: el token no lo trae. La página ya quedó suscrita desde el panel, así que no bloquea nada. |
| Dos canales muestran el mismo `••••XXXX` | Los tokens de Meta terminan casi siempre en `ZD`/`ZDZD`. El preview incluye la longitud justamente para poder distinguirlos. |
