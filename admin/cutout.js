// Admin dialog that removes a photo's background and lets staff review the curtain before publishing.
import { createCurtain } from "/js/curtain.js";

const IDLE_MS = 2 * 60 * 1000;
const LABELS = {
  slider: "Desliza para comparar el fondo",
  group: "Elegir fondo",
  original: "Original",
  backdrops: {
    studio: "Estudio",
    showroom: "Showroom",
    night: "Noche",
    white: "Blanco",
  },
};
const ERRORS = {
  "no-subject":
    "No se detectó un vehículo en esta foto. Prueba con una foto exterior donde se vea completo.",
  failed:
    "No se pudo procesar la foto. Comprueba tu conexión e inténtalo de nuevo.",
};

let worker = null;
let idleTimer = 0;
let nextJob = 0;

function stopWorker() {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = null;
}

// Keeps the model loaded between photos, then frees its memory once staff move on.
function extractMask(photo, onProgress) {
  clearTimeout(idleTimer);
  worker ||= new Worker("/admin/cutout-worker.js", { type: "module" });
  const running = worker;
  const id = ++nextJob;
  return new Promise((resolve, reject) => {
    running.onerror = () => {
      stopWorker();
      reject(new Error(ERRORS.failed));
    };
    running.onmessage = ({ data }) => {
      if (data.type === "download") return onProgress(data.ratio);
      if (data.type === "working") return onProgress(null);
      if (data.id !== id) return;
      idleTimer = setTimeout(stopWorker, IDLE_MS);
      if (data.type === "error")
        return reject(new Error(ERRORS[data.code] || ERRORS.failed));
      resolve(data);
    };
    running.postMessage({ id, photo });
  });
}

const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error(ERRORS.failed)),
      type,
      quality,
    ),
  );

async function renderResult(photo, { mask, width, height }) {
  const bitmap = await createImageBitmap(photo);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height);
  for (let i = 0; i < mask.length; i++) pixels.data[i * 4 + 3] = mask[i];
  context.putImageData(pixels, 0, 0);
  const cutout = await canvasBlob(canvas, "image/webp", 0.9);
  // Stored as opaque grey: a canvas premultiplies alpha, which would corrupt mask values.
  for (let i = 0; i < mask.length; i++) {
    const at = i * 4;
    pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = mask[i];
    pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return { cutout, mask: await canvasBlob(canvas, "image/png") };
}

// `photo` is { id, url, cutoutUrl }; `onChanged` runs after a cutout is saved or removed.
export function openCutoutDialog({ vehicleId, photo, api, notify, onChanged }) {
  const dialog = document.getElementById("cutoutDialog");
  dialog.innerHTML = `<div class="dialog-header"><h2>Quitar fondo</h2><button type="button" class="icon" data-action="close" aria-label="Cerrar">×</button></div>
    <div class="cutout-body">
      <div class="cutout-stage"><img class="curtain-photo" alt="Foto original"><div class="cutout-working" role="status" hidden><span class="cutout-spinner"></span><span class="cutout-message"></span></div></div>
      <p class="help cutout-note"></p>
      <p class="error" role="alert"></p>
      <div class="actions cutout-actions"></div>
    </div>`;
  const stage = dialog.querySelector(".cutout-stage");
  const working = dialog.querySelector(".cutout-working");
  const note = dialog.querySelector(".cutout-note");
  const failure = dialog.querySelector(".error");
  const actions = dialog.querySelector(".cutout-actions");
  stage.querySelector("img").src = photo.url;
  const curtain = createCurtain(stage);
  let previewUrl = "";
  let pendingMask = null;
  let closed = false;
  let busy = false;

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    pendingMask = null;
  };
  const button = (action, label, kind = "secondary") =>
    `<button type="button" class="${kind}" data-action="${action}">${label}</button>`;
  const setActions = (...items) => {
    actions.innerHTML = items.join("");
  };
  const setProgress = (ratio) => {
    dialog.querySelector(".cutout-message").textContent =
      ratio === null
        ? "Quitando el fondo…"
        : `Descargando el modelo (88 MB, solo la primera vez): ${Math.round(ratio * 100)}%`;
  };

  function showSaved() {
    note.textContent =
      "Este recorte está guardado. Los clientes ven la cortina en esta foto.";
    setActions(
      button("redo", "Volver a procesar"),
      button("remove", "Eliminar recorte"),
    );
    curtain.show(photo.cutoutUrl, LABELS);
  }
  async function process() {
    clearPreview();
    curtain.hide();
    failure.textContent = "";
    note.textContent = "";
    working.hidden = false;
    setActions();
    setProgress(null);
    busy = true;
    try {
      const response = await fetch(photo.url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(ERRORS.failed);
      const blob = await response.blob();
      const result = await renderResult(blob, await extractMask(blob, setProgress));
      if (closed) return;
      previewUrl = URL.createObjectURL(result.cutout);
      pendingMask = result.mask;
      note.textContent =
        "Revisa los bordes, las ventanas y las ruedas moviendo la cortina. Si guardas, los clientes verán este resultado.";
      setActions(
        button("save", "Guardar", "primary"),
        button("close", "Descartar"),
      );
      await curtain.show(previewUrl, LABELS);
    } catch (error) {
      if (closed) return;
      failure.textContent = error.message;
      setActions(button("redo", "Reintentar", "primary"));
    } finally {
      busy = false;
      if (!closed) working.hidden = true;
    }
  }
  async function submit(request, message) {
    setActions();
    try {
      await request();
      dialog.close();
      notify(message);
      await onChanged();
    } catch (error) {
      failure.textContent = error.message;
      showAgain();
    }
  }
  const showAgain = () =>
    pendingMask
      ? setActions(
          button("save", "Guardar", "primary"),
          button("close", "Descartar"),
        )
      : showSaved();

  dialog.onclick = (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "close") dialog.close();
    if (action === "redo") process();
    if (action === "save") {
      const form = new FormData();
      form.append("mask", pendingMask, "mask.png");
      submit(
        () =>
          api(`/api/admin/vehicles/${vehicleId}/photos/${photo.id}/cutout`, {
            method: "PUT",
            body: form,
          }),
        "Fondo quitado. La cortina ya está activa en esta foto.",
      );
    }
    if (action === "remove" && confirm("¿Eliminar el recorte de esta foto?"))
      submit(
        () =>
          api(`/api/admin/vehicles/${vehicleId}/photos/${photo.id}/cutout`, {
            method: "DELETE",
          }),
        "Recorte eliminado.",
      );
  };
  dialog.onclose = () => {
    closed = true;
    if (busy) stopWorker(); // Closing mid-run cancels the work.
    curtain.hide();
    clearPreview();
  };
  dialog.showModal();
  if (photo.cutoutUrl) showSaved();
  else process();
}
