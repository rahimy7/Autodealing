# Extensiones

Aquí vive lo que **un cliente necesita y los demás no**: el cotizador de uno, la
reserva de citas de otro, la integración con el ERP de un tercero. Son paquetes
del workspace, hermanos de `lib/db` o `lib/platform-config`, y existen para que
esas particularidades **no entren al core**.

La regla es una sola: si algo sirve a varios clientes, es core; si sirve a uno,
es extensión. Cuando una extensión termina usándose en cuatro o cinco clientes,
se promueve a módulo del core — y ahí sí se agrega a `MODULE_KEYS`.

## Crear una extensión

```
lib/extensions/cotizador/
  package.json      → { "name": "@extensions/cotizador", "exports": { ".": "./src/index.ts" } }
  tsconfig.json     → igual que el de lib/platform-config
  src/index.ts      → registerRoutes(), y lo que la extensión necesite exportar
```

`pnpm-workspace.yaml` ya incluye `lib/extensions/*`, así que basta con crear la
carpeta y correr `pnpm install`.

## Encenderla para un cliente

En el archivo del cliente (`lib/platform-config/src/clients/<id>.ts`):

```ts
extensions: ["cotizador"],
features: {
  "cotizador.requiereAprobacion": true,
},
```

`extensions` dice qué extensiones tiene esa instancia; `features` son las
banderas de grano fino que cada extensión define y documenta. El core no valida
las claves de `features`: son territorio de la extensión.

## Montarla en el servidor

El core no importa extensiones por su cuenta — eso volvería a meter lo
particular en lo común. El punto de montaje es explícito, en
`artifacts/api-server/src/routes/index.ts`:

```ts
import { clientConfig } from "../lib/client-config";

if (clientConfig.extensions.includes("cotizador")) {
  const { cotizadorRouter } = await import("@extensions/cotizador");
  router.use(cotizadorRouter);
}
```

Una extensión apagada no se monta, y sus rutas caen en el 404 de `/api` como
cualquier módulo apagado.

## Lo que una extensión no debe hacer

- Modificar tablas del core con migraciones propias. Si necesita datos, que
  cree **sus propias tablas**, con prefijo (`cotizador_solicitudes`).
- Depender de otra extensión. Si dos se necesitan mutuamente, son una sola.
- Leer `process.env` para saber de qué cliente se trata: eso ya está resuelto en
  `clientConfig`.
