# Premier Line Motors

Personalización del proyecto Novara-Motors para **Premier Line Motors**, según el formulario enviado en RVR el 27 de octubre de 2026.

## Entrega actual

- Diseño adaptable negro, dorado y plateado con el logo original.
- Contenido en inglés y español; recuerda el idioma en el navegador.
- Datos: 623–625 River Street, Paterson, NJ 07524; 201-625-0077; info@premierlinemotors.com.
- Contacto por teléfono, email, mapas y WhatsApp. El formulario prepara un mensaje; el visitante lo revisa y envía desde WhatsApp. Abrir WhatsApp no significa que una consulta fue recibida.
- Financiamiento descrito según RVR: entidades financieras y programas Buy Here Pay Here, sujeto a evaluación y aprobación. No se anuncian cuotas ni aprobaciones garantizadas.
- Catálogo preparado para vehículos reales, con búsqueda, filtro por carrocería y orden de precio/año. Sin inventario ficticio, reseñas inventadas ni horarios sin confirmar.
- Aviso de privacidad accesible desde el pie de página.

## Vista previa

```sh
python3 -m http.server 5179 --bind 127.0.0.1
```

Abrir http://127.0.0.1:5179.

## Inventario real

`data/inventory.json` contiene una lista vacía hasta recibir los datos del concesionario. Cada vehículo debe incluir:

- `id`: identificador estable de stock, string.
- `year`, `make`, `model`: año entero, marca y modelo.
- `price`, `miles`: números no negativos, USD y millas.
- `body`: carrocería (opcional).
- `photos`: lista de rutas `img/...` o enlaces HTTPS a fotografías reales.

El visitante puede consultar cada unidad por WhatsApp. No hay sincronización con DealerCenter/Autofunds todavía: se necesita el feed o acceso autorizado del concesionario, confirmar su formato e implementar su importación. No introducir credenciales en archivos públicos.

Si se agregan fotos locales, actualizar el Dockerfile para incluirlas. Actualmente solo copia los recursos realmente utilizados y excluye el catálogo de demostración anterior.

## Railway

`Dockerfile` y `railway.json` sirven el sitio mediante Caddy en el puerto asignado por Railway. Health check: `/`. No necesita secretos ni base de datos para esta entrega. Nunca desplegar el archivo `.env` de RVR.

Desde una sesión o token de Railway válido, seleccionar el servicio exclusivo de Premier Line Motors y ejecutar `railway up`, seguido de la generación del dominio si no existe. No reemplazar otros servicios de RVR.

## Pendientes externos

- Publicación mediante el servicio existente Autodealing, conectado a `rahimy7/Autodealing`, rama `main`. Dominio de Railway: https://autodealing-production.up.railway.app. La integración de Railway en RVR requiere revisar su token por separado; no se modificó para publicar este sitio.
- Inventario real y fotografías o feed autorizado.
- Confirmar el número de WhatsApp del concesionario: por ahora se usa el teléfono de contacto facilitado en RVR.
- Horario comercial, enlaces exactos a redes y dominio definitivo.

No se creó ni modificó una base de Neon. Al conectar una gestión de inventario o seguimiento de consultas, definir una base aislada para este cliente y controles de acceso.

Los módulos 3D y activos del prototipo original permanecen en el repositorio, fuera de la imagen publicada, para futuras decisiones de diseño.
