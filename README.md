# Premier Line Motors — sitio de dealer y administración

El sitio conserva la estructura original de Novara: vistas inmersiva y clásica, showroom 3D, catálogo, filtros, fotografías, detalle y calculadora. El catálogo comercial ahora se obtiene de Neon; los modelos conceptuales del showroom conservan sus recursos originales.

## Panel `/admin/`

- **Resumen:** inventario por estado, consultas pendientes, ventas, ingresos y margen bruto (solo administración).
- **Inventario:** altas y edición; stock/VIN únicos; borrador, disponible, reservado, vendido y archivado. Descripciones EN/ES, detalles técnicos, precios y destacados.
- **Fotografías:** 60 por vehículo, portada y orden, carga de JPG/PNG/WEBP hasta 10 MB. Se optimizan a WEBP y se guardan como binarios en la base exclusiva de Neon, nunca en el almacenamiento efímero de Railway.
- **Quitar fondo:** en cada foto, el botón «Quitar fondo» recorta el vehículo y muestra el resultado para revisarlo antes de guardar. Al guardar, el cliente ve en esa foto una cortina que puede deslizar para cambiar el fondo (estudio, showroom, noche o blanco). «Ver cortina» permite rehacer o eliminar el recorte.
- **Costos y gastos:** compra, transporte, reparaciones y acondicionamiento. Privados para administración; se fijan al cerrar una venta.
- **Ventas:** precio, comprador, contacto, fecha y notas internas. Una venta retira la unidad del catálogo. La anulación conserva el historial y devuelve la unidad a disponible. No ejecuta cobros ni genera contratos.
- **Consultas:** los formularios públicos guardan solicitudes en Neon, con estados nueva, contactada y cerrada. No se envían correos automáticos.
- **Página web:** datos comerciales, logo, redes y textos EN/ES de las secciones existentes.
- **Equipo:** cuentas con roles de administración y ventas; desactivación revoca sus sesiones.
- **Mi cuenta:** cambio de contraseña e invalidación de otras sesiones.
- Exportaciones CSV de inventario, ventas y consultas, con protección contra fórmulas.
- **Finanzas** (solo administración): ingresos, margen bruto, ticket y días en inventario por periodo; gráfico y tabla de los últimos 12 meses; inventario sin vender a precio de lista y a costo invertido; reservas activas y depósitos anotados; ventas del periodo con vendedor.
- **Desempeño** (solo administración): por vendedor, ventas, ingresos, margen, reservas (vendidas, perdidas, activas) y conversión, citas realizadas y no asistidas, pruebas de manejo, consultas web atendidas y, con Omnicanal, chats atendidos y tiempo de primera respuesta. Exportable a CSV.
- **Omnicanal** (solo administración): estado de la conexión, vínculo de cada usuario con su agente, inventario para los agentes de IA y automatizaciones.
- **Ventas** registra el vendedor que cierra: el dueño de una reserva vigente o quien registra; administración puede elegir otro. Un vendedor no puede vender una unidad que otro tiene reservada.

## App de ventas `/ventas/`

Para el teléfono del vendedor (instalable desde el navegador), con la misma cuenta y sesión del panel. El panel sigue disponible para el rol Ventas.

- **Hoy:** ventas del mes, reservas activas y por vencer, citas del día, consultas web sin asignar.
- **Catálogo:** búsqueda y carrocería, fotos, ficha, quién tiene reservada cada unidad. Desde la ficha: reservar para un cliente, agendar prueba de manejo, compartir el enlace (`/?v=<id>` abre esa unidad en la página pública), enviarlo por WhatsApp o a un chat de Omnicanal.
- **Reservas:** a nombre de un vendedor, con cliente, depósito anotado (no se cobra) y plazo de 1 a 30 días. La unidad figura como Reservado en la página. Se puede extender, liberar con motivo o convertir en venta. Al vencer, vuelve sola al catálogo. Solo quien reservó o administración la cambian; las unidades Demo no se reservan.
- **Agenda:** pruebas de manejo, visitas, entregas, llamadas y seguimientos en hora de Nueva York. Impide que un vendedor tenga dos citas a la vez y que una unidad tenga dos pruebas de manejo a la vez. Cada vendedor ve las suyas; administración ve y asigna todas.
- **Chats:** la bandeja de Omnicanal (ver abajo).
- **Consultas web:** tomar una consulta, agendarla con los datos que dejó el visitante y actualizar su seguimiento.

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
- **Agenda.** Las citas del equipo se crean también en Omnicanal, confirmadas y a nombre del agente, buscando primero al contacto por teléfono o email. Si ese cliente ya escribió por WhatsApp, Instagram o Facebook, Omnicanal le envía el recordatorio. Las citas que agenda la IA aparecen en la agenda de la app para *Confirmar*: pasan a la agenda del vendedor y Omnicanal las marca confirmadas y asignadas.
- **Consultas web** crean (o reutilizan) un contacto en el CRM con el detalle de la solicitud.
- **Administración general** de canales, bots, workflows, campañas y plantillas se hace en el panel de Omnicanal, en `/omnicanal/`. *Abrir panel de Omnicanal* (Administración → Omnicanal) entra con la misma cuenta del sitio:
  - una persona de administración entra como administradora de Omnicanal;
  - un vendedor entra solo como el agente con el que está vinculado.

Si Omnicanal no responde, nada se bloquea en el sitio: reservas, citas y ventas se guardan igual, la cita queda marcada *Sin sincronizar* y se reintenta al editarla.

Configuración:

- `OMNICANAL_SESSION_SECRET` (se genera con `openssl rand -hex 32`) enciende Omnicanal dentro del servicio. Sin ella, el sitio funciona igual, sin Omnicanal.
- Al arrancar, el sitio crea o actualiza las tablas de Omnicanal en el esquema `omnicanal` de `DATABASE_URL`, lo arranca y lo reinicia si se detiene.
  - Las dos aplicaciones tienen una tabla `appointments`, y cada una ve la suya.
  - La actualización de Omnicanal solo mira su esquema, así que nunca ve ni toca las tablas del sitio.
- `OMNICANAL_DATABASE_URL` es opcional y lleva Omnicanal a otra base.
- Las demás variables de Omnicanal (OpenAI, Supabase, `PUBLIC_BASE_URL`) van en este mismo servicio. La tabla está en [omnicanal/PREMIER.md](omnicanal/PREMIER.md).
- Para usar una instancia que corre en otro lado, en lugar de `OMNICANAL_DATABASE_URL` se pone `OMNICANAL_URL`, con su dirección https. En ese caso `OMNICANAL_SESSION_SECRET` debe ser **igual** al `SESSION_SECRET` de esa instancia.

La clave de sesión permite actuar en Omnicanal como cualquier agente: va solo como variable privada del servicio, nunca en Git ni en el navegador. Cambiarla cierra las sesiones abiertas del panel. El formato de la sesión replica `signToken` de Omnicanal (`omnicanal/artifacts/api-server/src/lib/auth.ts`); `tests/omnicanal.test.js` lo verifica contra la misma lógica, y la suite de la copia (`tests/premier-site.test.ts`) lo verifica contra la función real.

Los 12 vehículos originales y sus 36 fotos fueron importados con marca **Demo**, por solicitud del propietario. No pueden registrar ventas hasta que se actualicen con datos reales y se desmarque Demo. Los vehículos, cifras y reseñas del prototipo no son evidencia de operaciones reales. Los textos del prototipo pueden editarse desde Página web.

## Acceso inicial

La cuenta `admin` fue creada con una contraseña aleatoria. Su acceso se entrega al propietario en un archivo local privado fuera del repositorio. No hay contraseñas predeterminadas, credenciales en el código ni claves públicas. El administrador puede cambiar la contraseña desde Mi cuenta.

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

No colocar `.env` en Git. El servidor solo publica `/`, `/admin`, `/ventas`, `/css`, `/js`, `/img`, las rutas del API y, cuando Omnicanal está activo, `/omnicanal`. El código de servidor y los archivos de configuración no se sirven.

## Pruebas

```sh
npm test
```

Con `DATABASE_URL` se ejecuta también la integración real contra un esquema temporal aislado dentro de esa base. La prueba crea y elimina únicamente su esquema `premier_test_*`, sin modificar las tablas de producción. Cubre sesiones, CSRF, roles, aislamiento de costos, fotos privadas, publicación, versiones concurrentes, consultas, dos ventas simultáneas, anulación e historial, bloqueo de demos y contenido. `tests/sales-app.test.js` levanta además un Omnicanal de prueba que valida cada sesión firmada y aplica sus reglas de asignación, y cubre reservas simultáneas, vencimiento, ventas acreditadas, citas sin choques y su registro en Omnicanal, la bandeja como agente, adjuntos, consultas al CRM, inventario de la IA, finanzas y desempeño.

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
