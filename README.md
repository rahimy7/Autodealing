# Novara Motors — sitio de ventas para dealer (USA)

Sitio de concesionario con **dos vistas** que comparten el mismo contenido:

| Vista | Qué incluye |
| --- | --- |
| **Inmersiva** (por defecto) | Showroom 3D en vivo (Three.js) con piso espejo, anillos de neón, bloom y partículas · configurador de modelo y pintura · tarjetas con inclinación 3D · giro 360° controlado por scroll · cursor personalizado, marquesina, contadores animados |
| **Clásica** | Diseño de dealer tradicional: barra superior con teléfono/horario, buscador en el hero, filtros en barra lateral, vista cuadrícula/lista, colores navy + rojo |

El botón **Immersive / Classic** del menú cambia de vista (se recuerda en el navegador). El botón **ES/EN** cambia el idioma (inglés por defecto, detecta español automáticamente).

## Imágenes generadas
No hay fotos de stock ni modelos descargados: **todos los vehículos se generan por código** (`js/car-factory.js`) — 8 carrocerías (coupé, superdeportivo, sedán, SUV, SUV 3 filas, pickup, crossover eléctrico, hatchback) con faros LED, parrillas, rines, cálipers, espejos, manijas y líneas de puertas.

Con esos modelos se renderizan las fotos del sitio (`img/`):
- `img/cars/<id>-front|side|rear.webp` — 3 ángulos por vehículo, fondo transparente
- `img/spin/valtor-spectre/00–35.webp` — secuencia 360° del "vehículo del mes"
- `img/hero-classic.webp` — imagen principal de la vista clásica
- `img/showroom.webp` — escena de showroom (fondo de "Why Novara")

Los mismos modelos se usan en vivo en el hero 3D y en el visor **360° 3D** de cada vehículo (pestaña "360° 3D" dentro del detalle).

## Ejecutar en local
```bash
python3 tools/devserver.py
```
Abrir http://localhost:5179 (los módulos ES requieren servidor; no funciona con doble clic en `index.html`).

## Publicar en Railway
El sitio se sirve con **Caddy** dentro de un contenedor (`Dockerfile` + `Caddyfile`); `railway.json` le dice a Railway que use ese Dockerfile y que revise `/` como health check. Solo se publican `index.html`, `css/`, `js/` e `img/`: `tools/` (incluido el endpoint de guardado de `devserver.py`) y el README **no** van a producción.

**Opción A — desde GitHub (redeploy automático en cada push)**
1. Sube la carpeta a un repo de GitHub.
2. En Railway: *New Project → Deploy from GitHub repo* → elige el repo.
3. En el servicio: *Settings → Networking → Generate Domain* (o *Custom Domain* para tu dominio).

**Opción B — desde la terminal**
```bash
npm i -g @railway/cli
railway login
railway init        # crea el proyecto
railway up          # sube y despliega esta carpeta
railway domain      # genera la URL pública
```

No hace falta configurar variables: Railway asigna `PORT` y Caddy la lee sola. HTML, CSS y JS se revalidan en cada visita (un deploy se ve al instante); las imágenes se cachean 1 día.

## Cambiar inventario / regenerar fotos
1. Edita `js/data.js` (precio, millaje, specs, textos EN/ES y `config` 3D: `type`, `color`, `rim`, `rimFinish`, `caliper`, `roofColor`, `finish: 'matte'`, `grille: 'chrome'`…).
2. Con el servidor corriendo abre http://localhost:5179/tools/render.html — guarda todas las imágenes en `img/`.
   - Solo autos: `?only=cars` · un vehículo: `?only=cars&id=valtor-gt` · secuencia 360°: `?only=spin`
3. Para usar fotos reales del lote, reemplaza los archivos `img/cars/<id>-front|side|rear.webp` con el mismo nombre.

## Pendiente para producción
- **Formularios** (prueba de manejo, intercambio): hoy validan y muestran confirmación; conectar a tu CRM/DMS en `bindForms()` de `js/app.js` (hay un comentario con el `fetch`).
- **Reseñas**: los testimonios son de ejemplo — reemplázalos por reseñas reales de clientes.
- Datos del dealer (nombre, dirección, teléfono, horario, redes) son de ejemplo (`index.html`, `js/data.js`). Los teléfonos 555-01xx son ficticios.
- Revisa los textos legales del pie de página con tu cumplimiento (FTC / Florida).

## Estructura
```
index.html          página única (ambas vistas)
css/styles.css      tokens de diseño + estilos inmersivo / clásico
js/app.js           UI: inventario, filtros, modal, calculadora, formularios, idioma, vistas
js/data.js          inventario, modelos del showroom 3D, categorías
js/i18n.js          textos EN / ES
js/car-factory.js   generador procedural de vehículos 3D
js/studio.js        iluminación de estudio, sombras de contacto, encuadre de cámara
js/hero3d.js        escena 3D del hero (inmersiva)
js/viewer3d.js      visor 360° del modal
tools/render.html   genera las fotos del sitio
tools/lab.html      laboratorio para ajustar carrocerías
tools/devserver.py  servidor local (+ guarda los renders)
Dockerfile          imagen de producción (Caddy + archivos públicos)
Caddyfile           servidor de producción: puerto, compresión, caché, cabeceras
railway.json        configuración de build/deploy en Railway
```
