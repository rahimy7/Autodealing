# Plataforma: un core, muchas instancias

> **Esta carpeta es una copia independiente para Premier Line Motors** (ver
> [PREMIER.md](PREMIER.md)). Lo que sigue describe el modelo de la plataforma
> original, de la que esta copia se separó a propósito: aquí solo existen los
> clientes `premier` y `demo`, los cambios del original no llegan solos, y no
> se despliega como servicio propio: corre dentro del servicio del sitio de
> Premier, publicada en `/omnicanal/` de su dominio.

Este documento describe cómo el proyecto sirve a muchos clientes sin
multiplicarse. Es la referencia para dar de alta un cliente, decidir dónde va un
cambio y actualizar los despliegues.

## La regla

**Un solo código base. Una instancia por cliente. Ninguna rama por cliente.**

Cada cliente tiene su servicio, su base de datos, su dominio, sus credenciales de
Meta y su marca. Lo que **no** tiene es su propia copia del código: todos corren
la misma imagen, y lo que los distingue son sus variables de entorno y su archivo
de configuración.

```
                      CORE (este repositorio)
        login · canales · IA · CRM · automatización · reportes
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
     NICADOM               VibeRD               Premier
   CLIENT_ID=nicadom   CLIENT_ID=viberd    CLIENT_ID=premier
     DB propia            DB propia            DB propia
     dominio propio       dominio propio       dominio propio
     marca propia         marca propia         marca propia
```

La marca y los módulos se resuelven **en tiempo de ejecución**, no al compilar:
el servidor lee `CLIENT_ID` al arrancar y el frontend pide `GET /api/config` al
cargar. Por eso una sola compilación sirve a los 50 clientes.

## Dónde va cada cosa

| Si el cambio… | Va en | Ejemplo |
|---|---|---|
| Sirve a todos los clientes | **Core** | Corregir el webhook que duplica mensajes |
| Es marca, textos, módulos, zona horaria | **Configuración del cliente** | El color y el logo de Premier |
| Es una función que solo un cliente necesita | **Extensión** | El cotizador de NICADOM |
| Es una credencial o un secreto | **Variables de la instancia** | `DATABASE_URL`, `SESSION_SECRET` |
| Es una credencial de Meta | **Base de datos de la instancia** | Se guarda desde la página de Configuración |

Nada de lo anterior es una rama de git.

## Estructura

```
artifacts/
  api-server/          el backend: API, webhooks, motor de IA y de workflows
  omnicanal/           el panel web (una sola compilación para todos)
  mobile/              la app de agentes

lib/
  platform-config/     ⭐ el corazón del modelo
    src/schema.ts        qué puede configurar un cliente
    src/modules.ts       la lista de módulos del core
    src/clients/         un archivo por cliente ← aquí se da de alta
    src/version.ts       la versión del core
  db/                  el esquema de base de datos (igual para todas las instancias)
  api-spec/ api-zod/ api-client-react/    el contrato de la API y sus clientes
  extensions/          lo que es de un solo cliente (ver su README)

scripts/src/clients.ts consola de clientes (list · show · env · new)
```

El archivo de un cliente solo declara lo que ese cliente tiene de particular; el
resto lo pone el core por defecto:

```ts
export const premier = defineClient({
  id: "premier",
  name: "Premier Motors",
  domain: "chat.premiermotors.do",

  branding: {
    productName: "Premier Chat",
    logoUrl: "/logos/premier.png",
    primaryColor: "#E11D48",
    secondaryColor: "#111827",
  },

  business: {
    displayName: "Premier Motors",
    descriptor: "concesionario de vehículos",
    country: "República Dominicana",
  },

  modules: {
    catalog: false,     // no venden por catálogo
    marketing: false,   // no contrataron campañas
  },
});
```

⚠️ La configuración **viaja al navegador** y va dentro de la imagen: es identidad
y forma del producto, nunca secretos.

## Módulos

Un módulo apagado **deja de existir** para esa instancia: su router no se monta
(las rutas caen en el 404 de `/api`), su sección desaparece del menú y su URL
escrita a mano da "no encontrado". No es ocultar un botón.

La lista vive en `lib/platform-config/src/modules.ts`:

`whatsapp` · `instagram` · `facebook` · `inbox` · `feed` · `email` · `crm` · `catalog` ·
`marketing` · `customMessages` · `automation` · `aiAgents` · `knowledgeBases` ·
`appointments` · `orders` · `cases` · `inventory` · `purchasing` · `analytics` ·
`monitor` · `mobilePush`

Un módulo del core nace cuando la necesidad se repite. `appointments` es el
ejemplo: Vibe Center lo pidió como el objetivo de su instancia, pero agendar
citas le sirve igual a una clínica, un salón o un taller, así que es core
apagable y no una extensión de un cliente. Lo que se queda en `lib/extensions/`
es lo que nadie más va a querer.

`cases` nació igual, de otra necesidad repetida: un buzón de correo con semanas
de peticiones sin contestar (cancelaciones, paquetes que no llegaron, descuentos
por volumen). Atender peticiones que exigen una gestión le pasa a cualquiera que
tenga clientes.

`inventory` y `purchasing` (2026-10-04) son el ciclo de la mercancía: existencias
por almacén con lotes y costo PEPS, lo vendido comprometido hasta despacharse,
despachos por viaje o courier con sus cargos, y compras (pedido de compra → orden
al proveedor → recepción por lote). Van separados porque hay quien lleva
inventario sin comprarle a nadie desde el sistema. Devoluciones, notas de crédito
y la sincronización con Shopify son parte de `orders`; Shopify no hace nada sin
credenciales, como la tasa del día.

Los canales apagados además **descartan los webhooks** de ese canal: la app de
Meta puede estar suscrita a más de lo que el cliente contrató, y sin ese filtro
un comentario de Instagram abriría conversaciones en una instancia que no vende
Instagram.

Todos los módulos vienen encendidos: un cliente nuevo recibe el core completo y
se apaga lo que no compró.

## Vistas: qué ve cada persona

Los módulos son lo que el **cliente** contrató; las vistas son lo que cada
**persona de su equipo** puede abrir (2026-10-06). Una pantalla aparece solo si las
dos cosas se cumplen: la persona la tiene asignada y su módulo está encendido.

- **El acceso va por vista, no por rol.** La tabla `view_access` (`agent_id`,
  `view_key`) guarda una fila por usuario y vista. El rol (administrador / agente)
  solo propone con qué vistas arranca alguien nuevo (`DEFAULT_VIEWS_BY_ROLE`); desde
  ahí manda la tabla. Se edita en **Administración → icono de vistas** de cada usuario.
- **El catálogo** es `lib/platform-config/src/views.ts`: clave, etiqueta, grupo, ruta y
  módulo de cada vista. Las claves se guardan tal cual en la base: renombrar una deja
  sin acceso a quien la tenía.
- **El servidor lo hace cumplir**, no solo el menú: `VIEW_GATES`
  (`artifacts/api-server/src/lib/view-gates.ts`) dice qué vistas abre cada grupo de
  endpoints, y `requireView(...)` protege los que son de una sola pantalla. Lo que no
  está en esa lista lo puede usar cualquier usuario con sesión (conversaciones,
  mensajes, catálogo en lectura…), que es lo que el agente de servicio ya usaba.
- **El administrador de entorno** (`ADMIN_EMAIL`) no tiene fila de agente: ve todo el
  panel siempre, para que nadie pueda quedarse sin quién devuelva el acceso. Nadie
  puede quitarse a sí mismo la vista Administración, y no se guardan cero vistas.
- Los usuarios que ya existían conservan lo que veían: al arrancar, la API siembra las
  vistas de su rol a quien no tiene ninguna fila (`seedViewAccess`, idempotente). Quien
  se cree por SQL o por un script recibe las de su rol la primera vez que entra.

**Agregar una pantalla al panel**: su clave en `VIEW_KEYS` y `VIEWS`, su ícono en
`artifacts/omnicanal/src/lib/views.tsx`, su `<Route view="…">` en `App.tsx`, y su
prefijo en `VIEW_GATES` si tiene endpoints propios. Una vista nueva **no** se da sola
a quien ya existe: se le asigna desde Administración (el administrador de entorno la ve de inmediato).

## Dar de alta el cliente 21

```bash
pnpm clients:new premier "Premier Motors"   # crea su config y la registra
# editar lib/platform-config/src/clients/premier.ts (marca, módulos)
pnpm typecheck
pnpm clients:env premier                    # imprime las variables a cargar
```

Y en el proveedor (Railway):

1. **Servicio nuevo** apuntando a este repositorio (el mismo `Dockerfile`).
2. **Base de datos nueva** para el cliente y `DATABASE_URL` como referencia.
3. **Variables**: las que imprimió `clients:env` — `CLIENT_ID`, `SESSION_SECRET`
   (distinto por instancia), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, la clave de OpenAI.
4. **Dominio** del cliente.
5. Entrar como administrador y cargar las credenciales de Meta desde
   **Configuración** (ver `META.md`).

Copiar el proyecto, duplicar el repositorio o abrir una rama `cliente-premier`
**no** forma parte de este procedimiento.

## Git

Ramas de trabajo, no de cliente:

```
main                      lo que está publicado
develop                   integración
feature/whatsapp-agent    trabajo en curso
fix/webhook-duplicado
```

Una corrección se hace **una vez**, en `main`, y llega a los 50 clientes al
redesplegar. Con una rama por cliente habría que replicarla 50 veces, y algunas
ramas ya tendrían cambios incompatibles.

## Versión del core y actualizaciones

`lib/platform-config/src/version.ts` lleva la versión, y el commit se etiqueta
`v<versión>` al publicar. Cada instancia responde con la suya:

```bash
curl https://chat.premiermotors.do/api/readyz
# { "status": "ok", "db": "ok", "client": "premier", "coreVersion": "1.0.0" }
```

Las instancias **no tienen que actualizarse todas a la vez**: cada servicio se
despliega desde el tag que le corresponda, así que un cliente puede quedarse en
`v2.4` mientras el resto ya está en `v2.5`, sin mantener tres códigos base.

Al subir la versión: mayor = exige intervención (migración manual, variable
nueva obligatoria); menor = módulo o función nueva; parche = corrección.

## Inventario y centro de control

Lo que ya existe:

- `pnpm clients:list` — inventario de instancias, dominios y módulos.
- `pnpm clients:show <id>` — la configuración completa de una.
- `GET /api/config` — quién es la instancia, su marca y sus módulos.
- `GET /api/readyz` — salud, base de datos, cliente y versión del core.

Con eso, una consola web que liste los 50 clientes con su estado y su versión es
un consumidor de `readyz` y `config` — no necesita nada nuevo del core.

## Lo que este modelo evita

- **Rama por cliente**: cada corrección se multiplica por 50 y las ramas divergen.
- **Copia del proyecto por cliente**: aparecen versiones distintas y en poco
  tiempo nadie sabe qué tiene cada quien.
- **Marca compilada en el bundle**: obliga a una compilación por cliente y a
  redesplegar para cambiar un color.

Y lo que conserva del modelo de instancia dedicada: **aislamiento**. Un problema
en la base de datos o en la integración de un cliente no toca a los demás — algo
que se puede vender como "instancia dedicada de la plataforma".
