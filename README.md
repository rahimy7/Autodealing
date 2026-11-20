# Premier Line Motors — sitio de dealer y administración

El sitio conserva la estructura original de Novara: vistas inmersiva y clásica, showroom 3D, catálogo, filtros, fotografías, detalle y calculadora. El catálogo comercial ahora se obtiene de Neon; los modelos conceptuales del showroom conservan sus recursos originales.

## Panel `/admin/`

- **Resumen:** inventario por estado, consultas pendientes, ventas, ingresos y margen bruto (solo administración).
- **Inventario:** altas y edición; stock/VIN únicos; borrador, disponible, reservado, vendido y archivado. Descripciones EN/ES, detalles técnicos, precios y destacados. La ficha, el precio y la publicación son de administración: Ventas y Servicio ven el inventario y cargan unidades nuevas desde la app (ver *Unidades desde el lote*).
- **Fotografías:** 60 por vehículo, portada y orden, carga de JPG/PNG/WEBP hasta 10 MB. Todo el equipo agrega fotos a cualquier unidad. Ordenarlas, quitarlas o quitarles el fondo es de administración, o de quien cargó la unidad mientras siga en borrador. Se optimizan a WEBP y se guardan como binarios en la base exclusiva de Neon, nunca en el almacenamiento efímero de Railway.
- **Quitar fondo:** en cada foto, el botón «Quitar fondo» recorta el vehículo y muestra el resultado para revisarlo antes de guardar. Al guardar, el cliente ve en esa foto una cortina que puede deslizar para cambiar el fondo (estudio, showroom, noche o blanco). «Ver cortina» permite rehacer o eliminar el recorte.
- **Costos y gastos:** compra, transporte, reparaciones y acondicionamiento. Privados para administración; se fijan al cerrar una venta.
- **Ventas:** precio, comprador, contacto, fecha y notas internas. Una venta retira la unidad del catálogo. La anulación conserva el historial y devuelve la unidad a disponible. No ejecuta cobros ni genera contratos.
- **Consultas:** los formularios públicos guardan solicitudes en Neon, con estados nueva, contactada y cerrada. No se envían correos automáticos.
- **Página web:** datos comerciales, logo, redes y textos EN/ES de las secciones existentes.
- **Equipo:** cuentas con perfil Administración, Ventas o Servicio; desactivación revoca sus sesiones. Siempre queda al menos una persona activa de administración.
- **Mi cuenta:** cambio de contraseña e invalidación de otras sesiones.
- Exportaciones CSV de inventario, ventas y consultas, con protección contra fórmulas.
- **Finanzas** (solo administración): ingresos, margen bruto, ticket y días en inventario por periodo; gráfico y tabla de los últimos 12 meses; inventario sin vender a precio de lista y a costo invertido; reservas activas y depósitos anotados; ventas del periodo con vendedor.
- **Desempeño** (solo administración): por vendedor, ventas, ingresos, margen, reservas (vendidas, perdidas, activas) y conversión, citas realizadas y no asistidas, pruebas de manejo, consultas web atendidas y, con Omnicanal, chats atendidos y tiempo de primera respuesta. Exportable a CSV.
- **Omnicanal** (solo administración): en el menú, bajo *Omnicanal*, están las pantallas de Omnicanal (Bandeja Unificada, Feed de Publicaciones, Agenda, Contactos, Marketing, Workflow, Agentes, Reportes, Configuración…) y se abren dentro de esta misma página, sin otro menú ni otro inicio de sesión. La entrada *Omnicanal* misma muestra el estado de la conexión, el vínculo de cada usuario con su agente, el inventario para los agentes de IA y las automatizaciones.
- **Ventas** registra el vendedor que cierra: el dueño de una reserva vigente o quien registra; administración puede elegir otro. Un vendedor no puede vender una unidad que otro tiene reservada.

## App del teléfono (`mobile/`)

La app del equipo como aplicación nativa: **React Native con Expo** (SDK 58, TypeScript, Expo Router). Hace lo mismo que la versión web de abajo, con la misma cuenta, los mismos perfiles (Ventas, Servicio, Administración), la misma API y el mismo estilo de la página. No es una página instalada: es una app de Android (y de iPhone) con su propio ícono, cámara y menú de compartir del teléfono.

- **Pantallas:** Hoy, Catálogo (búsqueda, filtros y orden), ficha de la unidad, Agenda, Chats de Omnicanal, Cotizaciones (con vista previa en vivo), Reservas, Ventas, Consultas web, carga de unidades desde el lote con VIN y cámara, inventario y publicación (administración), Equipo, Negocio y Mi cuenta. El botón **+** crea lo que cada perfil necesita.
- **Cámara y fotos:** «Tomar foto» abre la cámara del teléfono; «Galería» deja elegir varias. Cada foto se reduce a un JPEG de 2048 px antes de subirla y una que falla no detiene a las demás.
- **Compartir por WhatsApp:** el mensaje con el enlace de la unidad, directo al número de un cliente, o una tarjeta con la foto, el precio, el logo y el teléfono (el texto queda copiado para pegarlo junto a la foto). Las cotizaciones se envían igual.
- **Sesión:** inicia con usuario y contraseña. La sesión (`premier_sid`) queda en el almacenamiento seguro del teléfono; si caduca o se cierra desde otro lado, la app pide entrar de nuevo.
- **Servidor:** la primera vez se escribe la dirección del sitio en la pantalla de entrada y se guarda en el teléfono. `EXPO_PUBLIC_API_URL` la fija por defecto al compilar. Con un servidor real se usa `https`. La app instalada en Android solo acepta `http` hacia `localhost`, `127.0.0.1` y `10.0.2.2` (las direcciones del propio teléfono, para probar con `adb reverse`; `mobile/plugins/with-local-cleartext.js`); una dirección de la red local necesita `https`, o probarse con Expo Go.
- **Cotizaciones:** las cifras salen de `mobile/src/lib/quote-math.js`, una copia de `js/quote-math.js`. Tras cambiar el original, `npm run sync:quote-math` (en `mobile/`) la actualiza; `tests/mobile.test.js` falla si difieren.

Desarrollo (Node 22 o más y un teléfono con **Expo Go**):

```sh
cd mobile
npm install
EXPO_PUBLIC_API_URL=https://tu-dominio npx expo start
```

Para probar contra un servidor local por USB: `adb reverse tcp:8081 tcp:8081` y `adb reverse tcp:5191 tcp:5191` (el puerto de ese servidor), `EXPO_PUBLIC_API_URL=http://localhost:5191` y abrir `exp://localhost:8081` en Expo Go.

APK instalable (Android; JDK 17 y el SDK de Android):

```sh
cd mobile
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# android/app/build/outputs/apk/release/app-release.apk  →  adb install -r app-release.apk
```

Ese APK se firma con la llave de depuración que genera Expo: sirve para instalarlo a mano en los teléfonos del equipo. Para publicarlo en Google Play o la App Store hace falta una llave propia o EAS (`npx eas-cli build`). Las carpetas `android/` e `ios/` se generan y no se guardan en Git; `mobile/` no entra en la imagen del servidor.

Por ahora no tiene notificaciones push (los chats nuevos se ven al abrir la app y en la insignia de Chats), el audio y el video de los chats se abren desde el panel, y quitar el fondo de una foto sigue en el panel de administración.

## Premier App en el navegador `/ventas/`

La misma app como página web instalable (PWA). Sigue disponible, también en `/app`, y comparte la API con la app del teléfono. Lo que sigue describe lo que hace cada perfil, y vale para las dos versiones.

La app del equipo para el teléfono, con el estilo de la página (oscuro, Unbounded y Manrope, el acento cian → violeta). Se instala desde el navegador (iPhone: Safari → Compartir → «Agregar a inicio»; Android: Chrome → «Instalar app») y usa la misma cuenta y sesión del panel. `/app` lleva a ella. En la computadora muestra un menú lateral; en el teléfono, cinco pestañas (Hoy, Catálogo, Agenda, Chats, Más) y el botón **+** con lo que cada perfil crea más.

| | Ventas | Servicio | Administración |
|---|---|---|---|
| Catálogo con filtros, ficha y compartir por WhatsApp | ✓ | ✓ | ✓ |
| Cargar unidades con fotos desde el lote | ✓ | ✓ | ✓ |
| Agenda propia y chats asignados de Omnicanal | ✓ | ✓ (citas de servicio) | ✓ (todas) |
| Cotizar, reservar, registrar ventas, consultas web | ✓ | — | ✓ |
| Precio, ficha y publicación de las unidades | — | — | ✓ |
| Equipo, negocio y ajustes de cotización | — | — | ✓ |

El servidor aplica estas reglas: lo que un perfil no ve en la app tampoco lo acepta la API (403).

- **Hoy:** según el perfil. Ventas ve ventas del mes, reservas, citas, cotizaciones y consultas web sin asignar. Servicio ve sus citas y sus unidades cargadas. Administración ve además las unidades por completar.
- **Catálogo:** búsqueda (marca, modelo, stock, VIN, color), carrocería y filtros por estado (disponibles, reservados, mis reservas), marca, año, precio, millaje, condición y combustible. Se ordena por fecha, precio, millaje o año. Desde la ficha, según el perfil:
  - cotizar, reservar, registrar la venta, agendar prueba de manejo o servicio;
  - compartir por WhatsApp: en el teléfono con una foto que lleva título, millas, precio, logo y teléfono, o directo al número de un cliente;
  - copiar el enlace (`/?v=<id>`), enviarlo a un chat de Omnicanal y agregar fotos.
- **Cotizaciones:** contado o pago mensual estimado (24 a 84 meses) con pago inicial, intercambio y tasa. El precio es el que cargó administración: una unidad sin precio no se cotiza, y solo administración cambia precio, cargos o impuesto en una cotización.
  - Impuesto, cargos de documentación, tasa y plazo por defecto, vigencia y nota al pie están en *Ajustes de cotización* (administración). El impuesto se calcula sobre el precio menos el intercambio; con impuesto en 0, la cotización dice que no lo incluye.
  - Las cifras se calculan con `js/quote-math.js`, la misma función que muestra la app al escribir, y se guardan con la cotización.
  - El cliente recibe por WhatsApp un enlace `/cotizacion/<token>`: la unidad, las cifras, el contacto del concesionario y «Imprimir / Guardar PDF». Está en español, o en inglés con `?lang=en`, y fuera de los buscadores. La foto se retira cuando la unidad deja de estar publicada.
  - Desde una cotización se reserva o se agenda para ese cliente.
- **Reservas:** a nombre de un vendedor, con cliente, depósito anotado (no se cobra) y plazo de 1 a 30 días. La unidad figura como Reservado en la página. Se puede extender, liberar con motivo o convertir en venta. Al vencer, vuelve sola al catálogo. Solo quien reservó o administración la cambian; las unidades Demo no se reservan.
- **Agenda:** pruebas de manejo, visitas, entregas, llamadas, seguimientos y servicio / taller, en hora de Nueva York. Impide que una persona tenga dos citas a la vez y que una unidad tenga dos pruebas de manejo a la vez. Cada quien ve las suyas; administración ve y asigna todas. Es la misma agenda de Omnicanal (ver abajo): las citas que agenda la IA por WhatsApp aparecen aquí como *Por confirmar*.
- **Chats:** la bandeja de Omnicanal (ver abajo), para quien está vinculado a un agente.
- **Consultas web:** tomar una consulta, agendarla con los datos que dejó el visitante y actualizar su seguimiento.
- **Equipo** (administración): crear usuarios con su perfil y una contraseña generada, cambiar nombre y perfil, restablecer la contraseña (cierra sus sesiones), desactivar y vincular a su agente de Omnicanal. La contraseña de `admin` con `ADMIN_PASSWORD` se cambia en la variable, no aquí.
- **Negocio** (administración): ventas, ingresos, margen y días en inventario del periodo; ingresos de 12 meses; unidades a la venta, por completar y con más de 60 días; el equipo y las ventas recientes.

### Unidades desde el lote

Cualquiera del equipo toca **+ → Cargar vehículo** y completa VIN, año, marca, modelo, versión, millaje, carrocería y color, toma las fotos con la cámara o las elige de la galería, y deja notas para administración.

- **Buscar VIN** llena año, marca, modelo, versión, carrocería, motor, tracción, transmisión y combustible con el decodificador público del Departamento de Transporte de EE. UU. (NHTSA vPIC). El servidor solo le envía el VIN.
- Las fotos se reducen en el teléfono a un JPEG de 2048 px antes de subirlas, incluidas las HEIC del iPhone. Una foto que falla no detiene a las demás y se reintenta.
- La unidad queda en **borrador, sin precio**, con un stock provisional `IN-<aammdd>-<3 letras>`. No aparece en la página, en el catálogo del equipo ni en el inventario de la IA. Quien la cargó la ve en *Mis unidades*: puede corregir sus datos, ordenar o quitar fotos y descartarla (queda archivada) mientras siga en borrador.
- Administración la encuentra en *Inventario → Por completar* (y en Hoy), con quién la cargó y sus notas. Completa precio y detalles y toca **Publicar**. Las notas de quien la cargó nunca llegan a la página.

## Ficha del vehículo en la página

Al tocar una unidad del inventario se abre su ficha: fotos, precio, datos y estas acciones.

- **Fotos a pantalla completa:** al tocar la foto de la ficha (o el botón de ampliar, arriba a la izquierda) se abren todas las fotos de la unidad sobre toda la pantalla.
  - Se pasan con las flechas, deslizando con el dedo o el mouse, con las miniaturas o con el teclado (← → Inicio Fin). Al llegar a la última vuelve a la primera.
  - Escape, la X o tocar fuera de la foto la cierran; la ficha queda en la última foto vista.
  - Si la foto tiene la cortina de fondo, arrastrar sigue moviendo la cortina y se amplía con el botón. En la vista 3D no hay ampliar.
- **Aplicar a financiamiento, Prueba de manejo y Agendar cita** abren su formulario dentro de la misma ficha, ya con la unidad elegida. Cada uno crea una consulta (*Financiamiento*, *Prueba de manejo* o *Cita*) en el panel, en la app de ventas y en el CRM de Omnicanal.
  - El financiamiento pide nombre, teléfono y, si el cliente quiere, pago inicial, situación laboral, ingreso mensual y crédito, en rangos. No consulta el crédito y nunca pide Seguro Social ni fecha de nacimiento: el vendedor completa la solicitud por teléfono.
  - La prueba de manejo y la cita piden día y hora. No se aceptan domingos ni fechas pasadas.
  - Las opciones se guardan en español aunque el visitante lea la página en inglés.
- **Enviar por WhatsApp:**
  - En el teléfono abre el menú de compartir con una foto de la unidad que lleva impresos el título, las millas, el precio, el logo y el teléfono, y un mensaje con los mismos datos y el enlace.
  - En la computadora abre WhatsApp con ese mensaje. La vista previa del enlace muestra la foto, el título y el precio.
- **Copiar enlace** copia `/?v=<id>`, el mismo enlace que comparten la app de ventas y los agentes de IA. La barra de direcciones también lo muestra mientras la ficha está abierta.
- **Vista previa de los enlaces** (`server/share.js`): `/?v=<id>` lleva en sus etiquetas Open Graph el título con el precio, las millas y la primera foto. La foto se sirve en JPEG de 1200×630 en `/media/vehicles/<vehículo>/<foto>.jpg` y se retira con la unidad, igual que las demás fotos. Con `&lang=en` el texto sale en inglés.

Las tarjetas del inventario no se mueven al pasar el puntero; solo se marca su borde.

## Leo, la mascota de la página

El león del concesionario flota en la esquina de la página pública (`js/mascot.js`, `css/mascot.css`, imágenes en `img/mascot/`). Sale de una moneda dorada y gira hacia el puntero. En el teléfono es más pequeño y el chat ocupa la pantalla. Al tocarlo se abre un chat en el idioma de la página.

- **Respuestas rápidas** (SUVs, lo más económico, financiamiento, horario y dirección, trade-in, hablar con un asesor): las contesta la página sola, con el inventario publicado y los datos de Página web.
- **Preguntas escritas:** las responde la IA (`server/assistant.js`). Conoce los datos del concesionario, los textos que el propietario editó en Página web y las unidades disponibles y reservadas.
  - Recomienda solo unidades de esa lista; el sitio descarta cualquier otra.
  - No promete aprobaciones, tasas, descuentos ni garantías, y no pide datos sensibles.
- **Sin IA**, la página contesta sola: busca en el inventario por tipo, marca, modelo, año, presupuesto y asientos, y lo que no sabe lo pasa a un asesor. Pasa cuando:
  - no hay clave o `MASCOT_AI=off`;
  - una misma conexión hace más de 25 preguntas en 10 minutos;
  - se llega al límite diario.
- **Botones:** abren la ficha del vehículo o el inventario ya filtrado. También llevan a la calculadora con el precio de la unidad, al formulario de trade-in o al de prueba de manejo con la unidad elegida, llaman o abren el mapa.
- **Hablar con un asesor:** pide nombre y teléfono o email y crea una consulta normal (Consultas en el panel y contacto en el CRM de Omnicanal). Lleva como nota las preguntas del visitante y la unidad de la que hablaban.
- Nunca ofrece unidades Demo, igual que la IA de Omnicanal.
- La conversación vive solo en la pestaña del visitante. El servidor no la guarda ni la escribe en el log.

Configuración:

- `AI_INTEGRATIONS_OPENAI_API_KEY`: la misma clave de OpenAI de Omnicanal. Sin ella, Leo funciona sin IA.
- `MASCOT_AI=off` apaga la IA de Leo aunque haya clave.
- `MASCOT_AI_MODEL`: por defecto `gpt-5-mini`, como los agentes de Omnicanal.
- `MASCOT_AI_DAILY_LIMIT`: máximo de respuestas con IA por día (hora de Nueva York), por defecto 500. Acota el costo. Pasado el límite, Leo sigue respondiendo sin IA.

## Integración con Omnicanal

El concesionario tiene su propia copia de la plataforma Omnicanal en la carpeta [`omnicanal/`](omnicanal/PREMIER.md), independiente del repositorio original: lo que cambie allá no llega aquí, y viceversa. Es parte de este mismo proyecto y del mismo despliegue. El servidor del sitio la arranca como un proceso aparte en un puerto interno y la publica en `/omnicanal/` de su dominio. Usa la misma base de datos: las tablas del sitio están en el esquema `public` y las de Omnicanal en su propio esquema, `omnicanal`. El sitio no importa su código: le habla por su API.

- **Vendedores como agentes.** Administración vincula cada usuario con su agente humano de Omnicanal. En la app de ventas el vendedor ve *Mis chats* y *Por atender* (incluidos los que atiende la IA), responde, toma conversaciones y las resuelve. El sitio firma para cada petición una sesión de Omnicanal de cinco minutos a nombre de ese agente, así que Omnicanal aplica sus propias reglas (no se contesta un chat asignado a otra persona; quien responde se queda con el chat), registra la presencia y lo cuenta en sus reportes. Un vendedor sin vínculo no accede a los chats. Los adjuntos se sirven a través del sitio, aislados, y solo imágenes, audio, video y PDF.
- **Desde un chat:** enviar un vehículo (título, precio, millaje y enlace), reservar o agendar con los datos del cliente. Una venta que sale de una reserva hecha en un chat se marca como venta cerrada en esa conversación.
- **Inventario para la IA.** El sitio mantiene una base de conocimiento en Omnicanal con las unidades disponibles y reservadas (sin Demo, sin vendidas ni borradores), precio y enlace. Se actualiza sola a los pocos segundos de cada cambio y se puede forzar desde Administración → Omnicanal. Para que el agente virtual la use hay que asignarla a su capacidad de ventas en Omnicanal → Agentes.
- **Agentes virtuales de WhatsApp.** Las respuestas automáticas las dan dos agentes de IA que se crean en Omnicanal (no en el código del sitio): **Asistente de ventas** (muestra unidades del inventario, responde datos del concesionario, financiamiento e intercambio sin prometer nada, y pasa al cliente a un asesor) y **Asistente de citas** (agenda pruebas de manejo y visitas de lunes a sábado; la cita queda *Por confirmar* y las preguntas de precio o financiamiento pasan en silencio al de ventas). Un flujo de trabajo clasifica cada mensaje con tres etiquetas (inventario, financiamiento, citas) y lo manda al agente que corresponde. Los textos, las etiquetas y los datos del concesionario están en [`tools/whatsapp-agents/spec.js`](tools/whatsapp-agents/spec.js); `node --env-file=.env tools/whatsapp-agents/apply.js` los crea en una instalación de Omnicanal vacía y se niega a correr si ya hay agentes, etiquetas, flujos o bases de conocimiento (nunca duplica ni sobrescribe). También crea la **bienvenida** por defecto (Omnicanal → Mensajes personalizados, activa en WhatsApp): una imagen con el logo ([`welcome.jpg`](omnicanal/artifacts/omnicanal/public/clients/premier/welcome.jpg), un archivo del propio panel que se sirve en `/omnicanal/clients/premier/` como el logo; se regenera con `node tools/whatsapp-agents/make-welcome-image.js`), el saludo y tres botones (*Ver vehículos*, *Agendar visita*, *Financiamiento*) cuyo toque lo contestan los agentes. Solo la recibe quien abre con un saludo: si el cliente empieza con una pregunta, el agente la contesta. La imagen necesita `PUBLIC_BASE_URL` (o el dominio de Railway) para que Meta pueda descargarla; sin dominio público la bienvenida sale solo con texto y botones. Una vez creados se editan en Omnicanal → Agentes y Mensajes personalizados, donde también se puede subir otra imagen: sin cuenta de Supabase los archivos se guardan en la base de datos (tabla `media_objects` del esquema `omnicanal`, que se crea sola al arrancar) y se entregan a Meta con enlaces firmados que caducan. Requieren `AI_INTEGRATIONS_OPENAI_API_KEY` en el servicio (la misma que usa Leo). La IA solo conoce los precios que están publicados: con «consultar precio» no da cifras. Para que el inventario lleve enlaces a cada ficha hay que guardar la *Dirección pública del sitio* en Administración → Omnicanal.
- **Agenda: una sola tabla.** La tabla `appointments` del sitio es también la agenda de Omnicanal: lee y escribe esa misma tabla, así que una cita que agenda un vendedor, una que agenda la IA y una que anota alguien en el panel de Omnicanal son la misma fila. No hay copias ni sincronización.
  - **Choques:** los comprueban los dos lados contra todas las citas. Omnicanal no da una hora que el sitio ya tiene ocupada, y el sitio no agenda encima de lo que acordó la IA.
  - **Estados:** `pending` es una cita que agendó la IA y nadie del equipo ha revisado (en la app, *Por confirmar*); `confirmed`, `completed`, `cancelled` y `no_show` son las demás. Los cambios de estado de un lado se ven en el otro.
  - **Vendedor y agente:** el vendedor del sitio y el agente de Omnicanal se mantienen iguales solos, según el vínculo de Administración → Omnicanal. Asignar la cita en uno la deja asignada en el otro.
  - **Confirmar** una cita de la IA (app de ventas) le pone tipo, vehículo y vendedor, la revisa contra la agenda del vendedor y la pasa a `confirmed`. Lo que pidió el cliente queda en las notas.
  - **Cliente:** el sitio busca o crea al cliente en el CRM de Omnicanal por teléfono o email y lo asocia a la cita (`omni_contact_id`). Si ese cliente ya escribió por WhatsApp, Instagram o Facebook, Omnicanal le envía el recordatorio. Una cita que nació en Omnicanal toma el nombre y el teléfono de su contacto.
- **Consultas web** crean (o reutilizan) un contacto en el CRM con el detalle de la solicitud.
- **Una sola administración.** La administración del sitio (`/admin/`) es también la de Omnicanal: canales, bots, workflows, campañas y plantillas se manejan desde sus entradas del menú, con la cuenta del sitio.
  - Una persona de administración entra como administradora de Omnicanal (o como su agente, si está vinculada). Un vendedor entra solo como el agente con el que está vinculado, en la app de ventas.
  - Omnicanal ya no tiene un formulario de contraseña propio cuando corre dentro del servicio: `/omnicanal/` sin sesión del sitio lleva al inicio de sesión de la administración.
  - Una dirección de `/omnicanal/…` abierta como página propia (escrita, guardada o la vuelta de la pantalla de permisos de Google) lleva a la administración, a esa pantalla (`/admin/#omnicanal/<pantalla>`). Su API, archivos y webhooks no cambian.
  - Las personas del equipo se crean en **Equipo**; la administración de usuarios de Omnicanal no se ofrece.

Si Omnicanal no responde, nada se bloquea en el sitio: reservas, citas y ventas se guardan igual. La cita ya es la misma que ve Omnicanal; lo único que falta es el cliente en su CRM, y la cita queda marcada *Sin sincronizar* hasta que se edita y se reintenta. Sin contacto, Omnicanal la muestra con el nombre que anotó el vendedor y no manda recordatorio.

Configuración:

- `OMNICANAL_SESSION_SECRET` (se genera con `openssl rand -hex 32`) enciende Omnicanal dentro del servicio. Sin ella, el sitio funciona igual, sin Omnicanal.
- Al arrancar, el sitio crea o actualiza las tablas de Omnicanal en el esquema `omnicanal` de `DATABASE_URL`, lo arranca y lo reinicia si se detiene.
  - La única tabla que comparten es la agenda, `appointments`, que es del sitio (esquema `public`). Omnicanal no tiene una propia: si aún tenía una con citas, el primer arranque las copia a la del sitio y quita la suya.
  - La actualización de Omnicanal solo mira su esquema, así que nunca ve ni toca las tablas del sitio, `appointments` incluida.
- `OMNICANAL_DATABASE_URL` ya no existe: Omnicanal siempre usa la base del sitio, porque la agenda es una sola tabla. Si está definida, el sitio se niega a arrancar Omnicanal y lo dice. `DATABASE_SCHEMA` solo puede ser `public` cuando Omnicanal corre dentro del servicio.
- Las demás variables de Omnicanal (OpenAI, Supabase, `PUBLIC_BASE_URL`) van en este mismo servicio. La tabla está en [omnicanal/PREMIER.md](omnicanal/PREMIER.md).
- Para usar una instancia que corre en otro lado se pone `OMNICANAL_URL`, con su dirección https. En ese caso `OMNICANAL_SESSION_SECRET` debe ser **igual** al `SESSION_SECRET` de esa instancia. Esa instancia atiende los chats, pero **no comparte la agenda**: las citas quedan solo en el sitio.

La clave de sesión permite actuar en Omnicanal como cualquier agente: va solo como variable privada del servicio, nunca en Git ni en el navegador. Cambiarla cierra las sesiones abiertas del panel. El formato de la sesión replica `signToken` de Omnicanal (`omnicanal/artifacts/api-server/src/lib/auth.ts`); `tests/omnicanal.test.js` lo verifica contra la misma lógica, y la suite de la copia (`tests/premier-site.test.ts`) lo verifica contra la función real.

Los 12 vehículos originales y sus 36 fotos fueron importados con marca **Demo**, por solicitud del propietario. El 19 de noviembre de 2026 se **archivaron** (stock `NV…`): ya no se publican ni los ve Leo ni Omnicanal, y conservan sus fotos y su historial en el panel (filtro *Archivado*). Se pueden volver a publicar cambiando su estado. Mientras tengan la marca Demo no pueden registrar ventas ni reservas.

Con solo unidades reales, las tarjetas de carrocería, los filtros y el buscador de la portada muestran únicamente las carrocerías que tienen unidades, cada tarjeta con la foto de una unidad real, y la franja de marcas de la vista clásica sale del inventario. Siguen siendo de prototipo la maqueta 3D de la portada (Valtor, Lumen, Kestrel), el giro 360° del Valtor Spectre y las reseñas. Los vehículos, cifras y reseñas del prototipo no son evidencia de operaciones reales. Los textos del prototipo pueden editarse desde Página web.

## Acceso inicial

La cuenta `admin` fue creada con una contraseña aleatoria. Su acceso se entrega al propietario en un archivo local privado fuera del repositorio. No hay contraseñas predeterminadas, credenciales en el código ni claves públicas. El administrador puede cambiar la contraseña desde Mi cuenta.

**Credenciales en el entorno (opcional).** Con `ADMIN_PASSWORD` (12 caracteres o más) y `ADMIN_EMAIL` en el `.env` o en las variables del servicio, esa es la contraseña de `admin`, y el correo también sirve como nombre de usuario. Es la única cuenta para la administración y para Omnicanal:
- Cada arranque pone la contraseña de `admin` igual a la de `ADMIN_PASSWORD`. Si cambia, se cierran las sesiones abiertas de `admin`, y queda en el historial (*Contraseña de administración tomada del entorno*). Cambiarla es cambiar la variable: lo que se cambie en *Mi cuenta* vuelve a la de la variable en el siguiente arranque.
- Sin `ADMIN_PASSWORD` no se toca la contraseña guardada, como antes. Una más corta de 12 se ignora y el arranque lo dice.
- `ADMIN_PASSWORD` es una clave de administración: va solo en el `.env` local (fuera de Git) y como variable privada del servicio.

## Desarrollo

Node.js 24. Instalar con `npm ci`. Configurar una conexión de Neon exclusiva en `DATABASE_URL` (TLS `sslmode=verify-full`). Para una base vacía se necesita `ADMIN_BOOTSTRAP_PASSWORD`; el arranque crea el esquema y la primera cuenta bajo un bloqueo transaccional. Una vez creada, no requiere esa variable y nunca sobrescribe su contraseña al reiniciar.

```sh
node --env-file=.env server/index.js
```

Para tener Omnicanal en local:

1. Corre `npm run omnicanal:build`, que necesita pnpm 11. Instala la copia y la compila para `/omnicanal/`.
2. Agrega `OMNICANAL_SESSION_SECRET` al `.env`. Omnicanal usará la misma base, en su esquema `omnicanal`.
3. El panel queda en `http://localhost:8080/omnicanal/`.

Para trabajar en el panel con recarga en caliente, ver [omnicanal/PREMIER.md](omnicanal/PREMIER.md).

No colocar `.env` en Git. El servidor solo publica `/`, `/admin`, `/ventas` (y `/app`), `/cotizacion/<token>`, `/css`, `/js`, `/img`, las rutas del API y, cuando Omnicanal está activo, `/omnicanal`. El código de servidor y los archivos de configuración no se sirven.

## Pruebas

```sh
npm test
```

Con `DATABASE_URL` se ejecuta también la integración real contra un esquema temporal aislado dentro de esa base. La prueba crea y elimina únicamente su esquema `premier_test_*`, sin modificar las tablas de producción. Cubre sesiones, CSRF, perfiles (Ventas, Servicio, Administración), aislamiento de costos, fotos privadas, publicación, versiones concurrentes, consultas, dos ventas simultáneas, anulación e historial, bloqueo de demos y contenido. `tests/sales-app.test.js` levanta además un Omnicanal de prueba que valida cada sesión firmada y aplica sus reglas de asignación, y cubre reservas simultáneas, vencimiento, ventas acreditadas, citas sin choques sobre la tabla compartida, el vendedor y el agente siempre alineados, las citas de la IA confirmadas en la misma fila, la bandeja como agente, adjuntos, consultas al CRM, inventario de la IA, finanzas y desempeño. También los perfiles (Servicio no reserva, cotiza ni vende), las unidades cargadas desde el lote hasta que administración las publica, las cotizaciones con el precio de administración y su página para el cliente, y la gestión del equipo, incluidos dos administradores que se quitan el perfil a la vez. `tests/quote.test.js` cubre las cifras de una cotización sin base de datos.

`tests/omni-embed.test.js` cubre Omnicanal dentro de este servicio:

- su arranque y su reinicio, en la base del sitio o en otra, y sin las variables del sitio;
- el paso de peticiones bajo `/omnicanal`: el cuerpo llega intacto para la firma de Meta, sin la cookie del sitio y con las políticas de seguridad;
- la entrada al panel con la cuenta del sitio.

La copia de Omnicanal tiene su propia suite (pnpm, TypeScript): ver [omnicanal/PREMIER.md](omnicanal/PREMIER.md). `npm test` no la ejecuta.

## Despliegue

Railway, servicio **Autodealing**, repositorio `rahimy7/Autodealing`, rama `main`.

- Docker ejecuta el servidor Node como usuario sin privilegios.
- `DATABASE_URL` se configura únicamente como variable privada del servicio.
- Health check `/health` verifica la conexión a Neon.
- Base exclusiva: proyecto Neon `bitter-glitter-87379602`, Virginia, Postgres 17, cómputo 0.25–1 CU con suspensión automática.
- Credenciales de administración y Neon no se incluyen en imágenes, paquetes ni Git.
- Sesiones con cookie HttpOnly y Secure en producción, caducidad de 12 horas, CSRF, límites de acceso y consultas públicas, contraseñas scrypt, SQL parametrizado, permisos en servidor y bitácora de cambios.
- Omnicanal va en la misma imagen y el mismo servicio:
  - El `Dockerfile` compila `omnicanal/` con pnpm. La imagen final lleva el sitio, el servidor y el panel de Omnicanal, y ffmpeg para las notas de voz.
  - La imagen se construye en x64.
  - Omnicanal se activa con `OMNICANAL_SESSION_SECRET` y usa la misma base de Neon, en el esquema `omnicanal`.
- Revisiones automáticas solo en horario de trabajo (`server/work-hours.js`):
  - **Qué hacen:** el sitio libera reservas vencidas; Omnicanal lanza campañas programadas, cierra chats inactivos y envía seguimientos y recordatorios.
  - **Cuándo:** de lunes a viernes, de 9:00 a 17:00 (hora de Nueva York), una vez por hora. Nunca los fines de semana.
  - **Para qué:** fuera de ese horario nada despierta a Neon salvo el uso real, así que el cómputo se suspende solo y no cobra.
  - **Sin esperar al horario:** los mensajes de los clientes se atienden al momento, y el catálogo público y la app de ventas liberan las reservas vencidas al abrirse.
  - **Cómo cambiarlo:** con `SCHEDULER_DAYS`, `SCHEDULER_HOURS` y `SCHEDULER_INTERVAL_MINUTES`. Detalle en [omnicanal/PREMIER.md](omnicanal/PREMIER.md).
  - Los pasos están en [omnicanal/PREMIER.md](omnicanal/PREMIER.md).

Las ventas son registros comerciales internos. Los documentos fiscales, financiamiento e integraciones con DealerCenter/Autofunds no forman parte de esta entrega. Los avisos automáticos a clientes (recordatorios, seguimientos, campañas) los envía Omnicanal, no este sitio.

Las fotos públicas se agrupan en `/media/vehicles/<vehículo>/<foto>.webp`. Al vender o archivar la unidad, esas direcciones devuelven 404 y el catálogo la retira; las fotos permanecen privadas para el historial y una posible anulación. No se usa el disco efímero de Railway. Las unidades sin precio confirmado pueden mostrar «Consultar precio» desde administración.

## Recorte de fondo

El recorte corre en el navegador de quien administra, sin costo por foto ni claves de API, con el modelo [ormbg](https://huggingface.co/onnx-community/ormbg-ONNX) (Apache-2.0). La primera vez descarga 88 MB desde Hugging Face y queda en caché. Tarda unos 2 segundos por foto con WebGPU y unos 20 sin él. El resultado se revisa antes de guardar porque el modelo puede dejar restos del fondo; no hay retoque manual.

El navegador solo envía una máscara. El servidor la combina con la foto ya guardada, así que una carga no puede cambiar la imagen del vehículo. El recorte se guarda en la columna `cutout` de `vehicle_photos` y se publica en `/media/vehicles/<vehículo>/<foto>/cutout.webp`, con el mismo retiro que las fotos al vender o archivar la unidad.

`admin/cutout-worker.js` tiene una CSP propia en `server/index.js`, sin acceso al API del sitio. Si se actualiza la versión de transformers.js en ese archivo, hay que revisar en esa CSP la versión de `onnxruntime-web` que carga.
