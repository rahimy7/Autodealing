# Premier Line Motors — sitio de dealer y administración

El sitio conserva la estructura original de Novara: vistas inmersiva y clásica, showroom 3D, catálogo, filtros, fotografías, detalle y calculadora. El catálogo comercial ahora se obtiene de Neon; los modelos conceptuales del showroom conservan sus recursos originales.

## Panel `/admin/`

- **Resumen:** inventario por estado, consultas pendientes, ventas, ingresos y margen bruto (solo administración).
- **Inventario:** altas y edición; stock/VIN únicos; borrador, disponible, reservado, vendido y archivado. Descripciones EN/ES, detalles técnicos, precios y destacados.
- **Fotografías:** 30 por vehículo, portada y orden, carga de JPG/PNG/WEBP hasta 10 MB. Se optimizan a WEBP y se guardan como binarios en la base exclusiva de Neon, nunca en el almacenamiento efímero de Railway.
- **Costos y gastos:** compra, transporte, reparaciones y acondicionamiento. Privados para administración; se fijan al cerrar una venta.
- **Ventas:** precio, comprador, contacto, fecha y notas internas. Una venta retira la unidad del catálogo. La anulación conserva el historial y devuelve la unidad a disponible. No ejecuta cobros ni genera contratos.
- **Consultas:** los formularios públicos guardan solicitudes en Neon, con estados nueva, contactada y cerrada. No se envían correos automáticos.
- **Página web:** datos comerciales, logo, redes y textos EN/ES de las secciones existentes.
- **Equipo:** cuentas con roles de administración y ventas; desactivación revoca sus sesiones.
- **Mi cuenta:** cambio de contraseña e invalidación de otras sesiones.
- Exportaciones CSV de inventario, ventas y consultas, con protección contra fórmulas.

Los 12 vehículos originales y sus 36 fotos fueron importados con marca **Demo**, por solicitud del propietario. No pueden registrar ventas hasta que se actualicen con datos reales y se desmarque Demo. Los vehículos, cifras y reseñas del prototipo no son evidencia de operaciones reales. Los textos del prototipo pueden editarse desde Página web.

## Acceso inicial

La cuenta `admin` fue creada con una contraseña aleatoria. Su acceso se entrega al propietario en un archivo local privado fuera del repositorio. No hay contraseñas predeterminadas, credenciales en el código ni claves públicas. El administrador puede cambiar la contraseña desde Mi cuenta.

## Desarrollo

Node.js 24. Instalar con `npm ci`. Configurar una conexión de Neon exclusiva en `DATABASE_URL` (TLS `sslmode=verify-full`). Para una base vacía se necesita `ADMIN_BOOTSTRAP_PASSWORD`; el arranque crea el esquema y la primera cuenta bajo un bloqueo transaccional. Una vez creada, no requiere esa variable y nunca sobrescribe su contraseña al reiniciar.

```sh
node --env-file=.env server/index.js
```

No colocar `.env` en Git. El servidor solo publica `/`, `/admin`, `/css`, `/js`, `/img` y las rutas del API; el código de servidor y archivos de configuración no se sirven.

## Pruebas

```sh
npm test
```

Con `DATABASE_URL` se ejecuta también la integración real contra un esquema temporal aislado dentro de esa base. La prueba crea y elimina únicamente su esquema `premier_test_*`, sin modificar las tablas de producción. Cubre sesiones, CSRF, roles, aislamiento de costos, fotos privadas, publicación, versiones concurrentes, consultas, dos ventas simultáneas, anulación e historial, bloqueo de demos y contenido.

## Despliegue

Railway, servicio **Autodealing**, repositorio `rahimy7/Autodealing`, rama `main`.

- Docker ejecuta el servidor Node como usuario sin privilegios.
- `DATABASE_URL` se configura únicamente como variable privada del servicio.
- Health check `/health` verifica la conexión a Neon.
- Base exclusiva: proyecto Neon `bitter-glitter-87379602`, Virginia, Postgres 17, cómputo 0.25–1 CU con suspensión automática.
- Credenciales de administración y Neon no se incluyen en imágenes, paquetes ni Git.
- Sesiones con cookie HttpOnly y Secure en producción, caducidad de 12 horas, CSRF, límites de acceso y consultas públicas, contraseñas scrypt, SQL parametrizado, permisos en servidor y bitácora de cambios.

Las ventas son registros comerciales internos. Los documentos fiscales, financiamiento, integraciones con DealerCenter/Autofunds y automatización de avisos no forman parte de esta entrega.
