# Omnicanal de Premier Line Motors

Esta carpeta es una **copia independiente** de la plataforma Omnicanal, solo para
Premier Line Motors. Atiende WhatsApp, Instagram y Facebook, con agentes de IA,
CRM, agenda y automatizaciones.

No es un proyecto aparte. **Corre dentro del servicio del sitio web** del
concesionario (la raíz de este repositorio) y se publica en `/omnicanal/` de su
mismo dominio. Es un solo despliegue, con un solo dominio, la misma base de
datos y la misma cuenta de acceso.

- **Origen:** commit `5182649` del repositorio Omnicanal, copiado el 2026-11-09,
  sin historial ni vínculo con ese repositorio.
- **Independencia:** las correcciones o funciones nuevas del original no llegan
  solas. Si alguna hace falta, hay que traerla a mano.
- **Cambios sin confirmar:** los que tenía el original en ese momento (la
  facturación con RVR) no se copiaron.

## Cómo corre dentro del sitio

El servidor del sitio (`server/omni-embed.js`) hace cinco cosas:

1. **Actualiza sus tablas.** Al arrancar, crea el esquema `omnicanal` en la base
   si no existe y lleva sus tablas al código desplegado, como
   `pnpm --filter @workspace/db run push`.
2. **Arranca Omnicanal** como un proceso aparte, en un puerto interno que solo
   escucha en `127.0.0.1` (`OMNICANAL_PORT`, 8090 por defecto). Si ese proceso
   se cae, lo vuelve a arrancar y espera más cada vez que falla al arrancar. Una
   caída de Omnicanal no tumba el catálogo.
3. **Lo publica en `/omnicanal/`.** Allí van el panel, su API
   (`/omnicanal/api/…`) y los webhooks de Meta. El cuerpo de cada petición pasa
   intacto, porque la firma de Meta depende de él. La cookie de sesión del sitio
   no pasa.
4. **Una sola administración: se entra con la cuenta del sitio**
   (`/omnicanal/entrar`, `server/omni-embed.js`, `omniEntry`):
   - Las pantallas de Omnicanal son entradas del menú de `/admin/` (bajo
     *Omnicanal*) y se abren dentro de su página, en un marco. El menú lo pide el
     sitio a Omnicanal (`GET /api/nav`, las vistas que la persona tiene y los
     módulos que la instancia enciende) y no lista *Administración* ni *Portal
     Plataforma*. En el marco, el panel no pinta su barra lateral
     (`artifacts/omnicanal/src/lib/embed.ts`).
   - Cada pantalla se abre por `/omnicanal/entrar?next=/pantalla`, que deja la
     sesión donde el panel la lee y aterriza en `next` (solo una ruta del panel,
     nunca otra dirección). La dirección de la administración la guarda
     (`/admin/#omnicanal/pantalla`), así que recargar o guardarla funciona.
   - Una persona de administración entra como administradora de Omnicanal (o
     como su agente, si está vinculada). Un vendedor entra solo como el agente
     con el que está vinculado, en la app de ventas.
   - La sesión dura 12 horas. Cerrar sesión en el sitio la cierra también aquí.
   - **Sin sesión del sitio**, `/omnicanal/` lleva al inicio de sesión de la
     administración (desde un marco, mueve la ventana entera).
   - **Una pantalla abierta como página propia** (dirección escrita o guardada,
     o la vuelta de Google) lleva, si quien abre es administrador, a su entrada
     en la administración. Su API, archivos y webhooks pasan tal cual.
   - **Omnicanal no recibe contraseñas.** El sitio le pasa `SITE_LOGIN_ONLY=1`:
     `POST /api/auth/login` responde 403 y la pantalla de entrada del panel manda
     a la cuenta del sitio. Así tampoco existe la cuenta de demostración que el
     servicio habilita en desarrollo sin `ADMIN_*`. Sin esa variable (el
     servicio por su cuenta, o para trabajar en el panel) conserva su formulario.
5. **Le pasa su configuración.** Omnicanal lee sus propios nombres de variable.
   El sitio se los da a partir de las suyas:

   | Omnicanal recibe | Sale de |
   |---|---|
   | `DATABASE_URL` | el mismo `DATABASE_URL` del sitio (no hay otra base: la agenda es una sola tabla) |
   | `SESSION_SECRET` | `OMNICANAL_SESSION_SECRET` |
   | `PORT`, `HOST` | `OMNICANAL_PORT` (8090), `127.0.0.1` |
   | `PUBLIC_BASE_URL` | `PUBLIC_BASE_URL` del sitio más `/omnicanal`; sin ella, el dominio de Railway |
   | `CLIENT_ID` | `premier` |
   | `SCHEDULER_DAYS`, `SCHEDULER_HOURS`, `SCHEDULER_INTERVAL_MINUTES` | el horario del equipo (`server/work-hours.js`): `1-5`, `09:00-17:00`, `60` |
   | el resto (OpenAI, Supabase, `ADMIN_*`, `LOG_LEVEL`…) | la misma variable del servicio |

   `DATABASE_SCHEMA` y `ADMIN_BOOTSTRAP_PASSWORD` son del sitio y no le llegan.

**Comparte la base del sitio, en su propio esquema, y una sola tabla: la agenda.**
Las tablas del sitio están en `public` y las de Omnicanal en `omnicanal`. La
única que no se reparte es `appointments`, la agenda: es la del sitio (esquema
`public`) y Omnicanal la lee y la escribe tal cual, así que una cita que agenda
la IA y una que anota un vendedor son la misma fila. El resto de la separación
se sostiene en tres puntos:

- **Consultas.** Todas las tablas y tipos se declaran con
  `pgSchema("omnicanal")` (`lib/db/src/schema/pg-schema.ts`), así que cada
  consulta lleva el esquema. Las pocas escritas a mano sin esquema resuelven
  allí por el `search_path` de sus conexiones.
- **Actualización.** drizzle-kit solo mira ese esquema (`schemaFilter` en
  `lib/db/drizzle.config.ts`), así que nunca ve ni toca las tablas del sitio.
  Como drizzle-kit 0.31 no crea el esquema, `lib/db/ensure-schema.mjs` lo crea
  antes.
- **Choque de nombres.** El sitio se niega a arrancar Omnicanal si el propio
  sitio usa `DATABASE_SCHEMA=omnicanal`, o cualquier esquema que no sea `public`.

`OMNICANAL_DATABASE_URL` ya no existe: con la agenda compartida, Omnicanal solo
puede vivir en la base del sitio, y el sitio se niega a arrancarlo si está
definida.

**La agenda compartida.**

- **Dónde se define.** El sitio crea y migra la tabla (`server/schema.sql`, así
  existe aunque Omnicanal esté apagado). Omnicanal la declara con el `pgTable`
  de drizzle sin esquema y con los nombres de columna del sitio
  (`lib/db/src/schema/appointments.ts`). drizzle-kit la ignora por su
  `schemaFilter`.
- **Columnas de Omnicanal.** Su número de cita es `omni_appointment_id` (cada
  fila recibe uno sola, de una secuencia), el contacto `omni_contact_id`, la
  conversación `omni_conversation_id`, y además `agent_id`, `service`,
  `location`, `source` y `reminder_sent_at`. Sus tiempos son `timestamptz`.
- **Columnas del sitio.** `id` (uuid), `kind`, `seller_id`, `vehicle_id`,
  `lead_id`, `customer_*`, `created_by`. Omnicanal no las escribe: tienen
  valores por omisión, y un disparador (`appointments_link`) completa el
  nombre del cliente desde su contacto y mantiene `seller_id` y `agent_id`
  alineados vía `admin_users.omni_agent_id`.
- **Estados.** `pending` (la IA la agendó y nadie la revisó), `confirmed`,
  `completed`, `cancelled`, `no_show`.
- **Una cita sin contacto.** El sitio puede guardar una cita antes de tener al
  cliente en el CRM (si Omnicanal no respondía). Omnicanal la muestra con el
  nombre del sitio, cuenta su hueco en los choques y no le manda recordatorio
  hasta que tenga contacto.
- **Migración.** Una instalación que aún tenía la tabla propia de Omnicanal la
  recibe en el primer arranque: `server/appointments-merge.js` copia sus filas
  a la del sitio (con su número, o uno nuevo si ya estaba tomado) y la borra
  junto con sus tipos, antes de la actualización de drizzle-kit, para que esta
  no tenga nada que eliminar. Es una sola transacción.

**Revisiones automáticas solo en horario de trabajo.** El programador de
Omnicanal (`src/lib/scheduler.ts`) lanza campañas programadas, cierra chats
inactivos y envía seguimientos y recordatorios de citas.

- **Cuándo corre:** de lunes a viernes, de 9:00 a 17:00 (hora de Nueva York),
  una vez por hora: 9:00, 10:00 … 17:00. Nunca los fines de semana.
  - Sin `SCHEDULER_*` corre cada minuto, siempre. Así era el original.
  - Cada vuelta consulta la base, y Neon solo se suspende tras 5 minutos sin
    consultas. Revisar cada minuto la mantenía despierta y cobrando todo el día.
- **Lo que no espera al horario:** los mensajes que llegan por los canales y las
  respuestas de la IA se atienden al momento, a cualquier hora.
- **Lo que sí puede esperar:**
  - un recordatorio de cita puede salir hasta una hora tarde, y las citas del
    lunes temprano se recuerdan el lunes a las 9:00;
  - una campaña programada sale en la siguiente vuelta del horario: si es para
    el sábado, el lunes a las 9:00;
  - un seguimiento que vence el fin de semana sale el lunes. Si para entonces
    pasaron más de 24 horas desde el último mensaje del cliente, WhatsApp ya no
    permite un mensaje libre.
- **Cómo cambiarlo:** con `SCHEDULER_DAYS` (1 = lunes … 7 = domingo),
  `SCHEDULER_HOURS` y `SCHEDULER_INTERVAL_MINUTES` en el servicio. El sitio usa
  el mismo horario para liberar reservas vencidas.
  `tests/scheduler-window.test.ts` comprueba que los dos dan las mismas vueltas.

El panel comparte el dominio del sitio, así que se le aplica la misma política
de seguridad:

- solo ejecuta sus propios scripts;
- nada de lo que sirve su API (por ejemplo, un adjunto abierto en otra pestaña)
  puede ejecutarse como página;
- no lo indexan los buscadores.

## Qué tiene de Premier

- **Configuración del cliente:** `lib/platform-config/src/clients/premier.ts`.
  Incluye la marca *Premier Chat*, los colores del sitio, el logo, la zona
  horaria `America/New_York`, la moneda USD y la descripción del negocio que
  leen los agentes de IA.
- **Módulos apagados:** pedidos, inventario por almacén, compras, casos y
  catálogo de productos. El inventario de vehículos vive en el sitio y llega a
  la IA como una base de conocimiento que el sitio mantiene. Para encender uno
  de esos módulos, cambia su línea a `true` en ese archivo.
- **Cliente por defecto:** sin `CLIENT_ID`, la instancia arranca como `premier`.
  `demo` sigue disponible para desarrollo.
- **Esquema propio:** todas las tablas y tipos van en el esquema `omnicanal` de
  la base, también cuando corre sola o en las pruebas.
- **Cambios para vivir bajo `/omnicanal/`:**
  - `build-embedded.sh` compila el panel con ese prefijo.
  - `artifacts/omnicanal/src/lib/base-path.ts` pone el prefijo en las llamadas
    al API, el logo y las direcciones de los webhooks de Meta y de Google.
  - El login muestra *Entrar con mi usuario de Premier Line Motors*.
  - El servidor acepta `HOST` y la vuelta de Gmail bajo una ruta.

  Sin el prefijo, la copia sigue funcionando en la raíz.

## Qué se dejó fuera

Todo lo que era de otros clientes de la plataforma:

- sus configuraciones (NicaDom, Zona Saludable, Vibe Center, Linaje Real y
  Procollagen);
- las imágenes de cuentas bancarias y formas de pago;
- catálogos, propuestas comerciales y scripts de carga;
- altas de personal con nombres y correos reales;
- las pruebas que verificaban sus textos.

Tampoco vinieron las *skills* de Claude del repositorio original ni los
archivos de Replit. Se quitaron también los archivos de despliegue propio
(`Dockerfile`, `railway.json` y `RAILWAY.md`), porque Omnicanal ya no se
despliega aparte: lo hace el `Dockerfile` de la raíz.

El código del núcleo casi no se modificó, aunque todavía contiene casos
especiales atados al id de otros clientes, como las sucursales de NicaDom o las
peticiones pastorales de Linaje Real. Ninguno se activa con `CLIENT_ID=premier`.

La app móvil (`artifacts/mobile`) quedó tal cual y sigue siendo la app OmniAI
publicada. Los vendedores no la necesitan, porque atienden desde `/ventas/` en
el sitio.

## Desarrollo local

**Todo junto, como en producción.** Desde la raíz del proyecto:

```sh
npm run omnicanal:build   # pnpm 11: instala y compila Omnicanal para /omnicanal/
```

Después agrega al `.env` del sitio esta variable y arranca el sitio. Omnicanal
usará la misma base, en su esquema `omnicanal`:

```sh
OMNICANAL_SESSION_SECRET=<openssl rand -hex 32>
```

```sh
node --env-file=.env server/index.js
```

El panel queda en `http://localhost:8080/omnicanal/`. Hay que volver a correr
`npm run omnicanal:build` después de cada cambio en esta carpeta.

**Solo el panel, con recarga en caliente.** Desde esta carpeta:

```sh
pnpm install
cp .env.example .env   # completar DATABASE_URL, SESSION_SECRET, ADMIN_*, OpenAI
./start.sh             # Postgres + API en :8080 + panel en :5173, en la raíz
```

Para que el sitio local use esa instancia, arráncalo en otro puerto con
`OMNICANAL_URL=http://localhost:8080` y con
`OMNICANAL_SESSION_SECRET` igual al `SESSION_SECRET` de ese `.env`.

## Pruebas

```sh
cd omnicanal
createdb omnicanal_test
export DATABASE_URL=postgresql://localhost:5432/omnicanal_test
pnpm --filter @workspace/db run push
pnpm run typecheck
pnpm --filter @workspace/api-server test
```

`tests/premier-site.test.ts` comprueba que las sesiones que firma el sitio
(`../server/omnicanal.js`) son válidas para el `verifyToken` real de esta copia.
En la raíz, `tests/omni-embed.test.js` cubre:

- el arranque y el reinicio del proceso;
- el paso de peticiones bajo `/omnicanal`;
- la entrada con la cuenta del sitio.

Algunas pruebas de envíos (USPS y Shopify) comparten filas de la base y a veces
fallan cuando corren en paralelo. En el original pasaba igual. En serie pasan
todas:

```sh
pnpm --filter @workspace/api-server exec node --import tsx --test --test-concurrency=1 'tests/*.test.ts'
```

## Despliegue en Railway

Va en el mismo servicio del sitio (**Autodealing**). El `Dockerfile` de la raíz
compila Omnicanal y lo incluye en la imagen, junto con ffmpeg para las notas de
voz. La imagen se construye en x64, como en Railway.

1. **Base.** No hay nada que crear: usa la misma base de Neon del sitio
   (`DATABASE_URL`), en el esquema `omnicanal`, que se crea solo al primer
   arranque.
   - Las revisiones automáticas solo corren en horario de trabajo (ver *Cómo
     corre dentro del sitio*).
   - Fuera de ese horario, Neon solo se despierta cuando hay uso real: un
     mensaje, una visita o alguien en el panel.
2. **Variables del servicio:**

   | Variable | Valor |
   |---|---|
   | `OMNICANAL_SESSION_SECRET` | `openssl rand -hex 32` (enciende Omnicanal) |
   | `PUBLIC_BASE_URL` | el dominio público del sitio, p. ej. `https://premierlinemotors.com` (sin él se usa el de Railway) |
   | `AI_INTEGRATIONS_OPENAI_API_KEY` | clave de OpenAI (sin ella la IA no contesta) |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | adjuntos: fotos, notas de voz, documentos |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | opcional: la contraseña de la cuenta `admin` **del sitio** y su correo como nombre de usuario (`server/admin-env.js`). Omnicanal ya no las usa |

   `OMNICANAL_URL` no se usa en este modo: déjala vacía. `OMNICANAL_DATABASE_URL`
   ya no existe.
3. **Despliega** (push a `main`). En el log aparecen, en este orden:
   - `Premier server ready`;
   - la creación de las tablas de Omnicanal (`Changes applied`);
   - el `Server listening` de Omnicanal en `127.0.0.1`.
4. **Meta.** El webhook es `https://<dominio>/omnicanal/api/webhooks/meta`.
   - El panel lo muestra en **Configuración → Conexión con Meta**.
   - Allí mismo se cargan las credenciales (ver `META.md`).
5. **Equipo.** Entra a Administración y abre *Omnicanal → Agentes*.
   - En **Agentes** crea los agentes humanos y asigna la base de conocimiento
     *Inventario del concesionario (sincronizado)* al agente virtual de ventas.
   - En el sitio, vincula cada vendedor con su agente.

Si una actualización del esquema pide confirmar que se borrarán datos, el
arranque no puede responder. En ese caso:

1. Omnicanal arranca con el esquema que tiene y el log lo avisa.
2. Abre una terminal en el servicio con `railway ssh`.
3. Corre `npm run omnicanal:migrate` y confirma.

Si existía un segundo servicio de Omnicanal en el proyecto de Railway, bórralo:
ya no hace falta.

`OMNICANAL_SESSION_SECRET` equivale a la clave de administración: con ella se
puede actuar como cualquier agente. Va solo como variable privada del servicio,
nunca en Git ni en el navegador. Cambiarla cierra las sesiones abiertas del
panel.
