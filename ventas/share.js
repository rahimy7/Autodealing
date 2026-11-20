// Sharing a vehicle from the app. On a phone the share sheet sends a picture of the unit with its
// title, miles, price, the logo and the phone printed on it, together with a message and the link
// (/?v=<id>, whose preview also shows the photo: server/share.js). Elsewhere WhatsApp opens with
// the message. Same picture as the public page's (js/app.js), in the app's colors.
import { S, api, esc, num, title, priceText, publicLink, notify, sheet, closeSheet, waLink, digits, ICONS } from "./core.js";

const coarse = matchMedia("(pointer: coarse)").matches;

async function dealer() {
  if (!S.dealer) S.dealer = await api("/api/site").catch(() => ({}));
  return S.dealer;
}

export function shareText(v, d = S.dealer || {}) {
  const facts = [v.miles ? `${num(v.miles)} millas` : "", v.drive, typeof v.ext === "string" ? v.ext : v.ext?.es].filter(Boolean);
  return [
    `*${title(v)}*`,
    `Precio: ${priceText(v)}`,
    facts.join(" · "),
    [d.name || "Premier Line Motors", d.phone].filter(Boolean).join(" · "),
    publicLink(v.id),
  ]
    .filter(Boolean)
    .join("\n");
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });

function fitText(g, text, x, y, maxWidth, size, weight, family = "Manrope") {
  let s = size;
  const font = () => (g.font = `${weight} ${s}px ${family}, system-ui, sans-serif`);
  font();
  while (s > size * 0.7 && g.measureText(text).width > maxWidth) (s -= 2), font();
  let out = text;
  while (out.length > 1 && g.measureText(out).width > maxWidth) out = out.slice(0, -2) + "…";
  g.fillText(out, x, y);
}

// A square picture: the first photo above a band with the title, price and the dealer.
async function shareImage(v) {
  const W = 1080, PH = 760, H = 1080, pad = 56;
  const d = await dealer();
  const [photo, logo] = await Promise.all([
    v.photos?.[0] ? loadImage(v.photos[0]) : Promise.reject(new Error("Sin foto")),
    loadImage("/api/site/logo").catch(() => null),
    document.fonts?.load("800 60px Manrope").catch(() => {}),
    document.fonts?.load("600 60px Unbounded").catch(() => {}),
  ]);
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = c.getContext("2d");
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, W, H);
  const k = Math.max(W / photo.naturalWidth, PH / photo.naturalHeight);
  const pw = photo.naturalWidth * k, ph = photo.naturalHeight * k;
  g.drawImage(photo, (W - pw) / 2, (PH - ph) / 2, pw, ph);
  const band = g.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, "#38e1ff");
  band.addColorStop(0.55, "#7c5cff");
  band.addColorStop(1, "#ff4fd8");
  g.fillStyle = band;
  g.fillRect(0, PH, W, 6);
  const glow = g.createRadialGradient(W * 0.85, H, 10, W * 0.85, H, 520);
  glow.addColorStop(0, "rgba(124,92,255,0.28)");
  glow.addColorStop(1, "rgba(124,92,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, PH + 6, W, H - PH);
  const logoW = logo ? Math.min(250, (logo.naturalWidth / logo.naturalHeight) * 94) : 0;
  const textW = W - pad * 2 - (logoW ? logoW + 30 : 0);
  g.fillStyle = "#eef1f6";
  fitText(g, [v.year, v.make, v.model].filter(Boolean).join(" "), pad, PH + 90, textW, 50, 800);
  g.fillStyle = "#8a92a5";
  fitText(g, [v.trim, v.miles ? `${num(v.miles)} millas` : ""].filter(Boolean).join(" · "), pad, PH + 138, textW, 30, 600);
  g.fillStyle = band;
  fitText(g, priceText(v), pad, PH + 250, textW, 78, 600, "Unbounded");
  g.textAlign = "right";
  if (logo) g.drawImage(logo, W - pad - logoW, PH + 40, logoW, logoW * (logo.naturalHeight / logo.naturalWidth));
  g.fillStyle = "#eef1f6";
  if (d.phone) fitText(g, d.phone, W - pad, PH + 246, 300, 32, 800);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Sin imagen");
  const name = title(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vehiculo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

// Made as soon as the share options open, so the share sheet opens right on the tap: browsers
// only open it inside the tap itself.
let cache = { id: "", file: null };
function prepare(v) {
  if (!coarse || !navigator.canShare || !v.photos?.length) return null;
  if (cache.id !== v.id) cache = { id: v.id, file: shareImage(v).catch(() => null) };
  return cache.file;
}

// The share options: WhatsApp with the picture, straight to a customer's number, or the link.
export async function shareSheet(v, { phone = "" } = {}) {
  await dealer();
  const pending = prepare(v);
  const body = sheet(
    "Compartir vehículo",
    `<p class="help">${esc(title(v))} · ${esc(priceText(v))}. El enlace abre la ficha en la página, con sus fotos.</p>
    <div class="form mt12">
      <button class="wa-btn block" id="shWa" type="button">${ICONS.whatsapp}Enviar por WhatsApp${coarse && v.photos?.length ? " con foto" : ""}</button>
      <form id="shTo" class="form"><label>A un número de cliente<span class="input-action"><input name="phone" type="tel" inputmode="tel" placeholder="(201) 555-0100" value="${esc(phone)}" autocomplete="off"><button class="secondary" type="submit">Enviar</button></span></label></form>
      <div class="action-grid">
        <button class="secondary" id="shNative" type="button">${ICONS.share}Más opciones</button>
        <button class="secondary" id="shCopy" type="button">${ICONS.link}Copiar enlace</button>
      </div>
    </div>`,
  );
  const text = shareText(v);
  body.querySelector("#shWa").onclick = () => {
    const wa = "https://wa.me/?text=" + encodeURIComponent(text);
    if (!pending) return void window.open(wa, "_blank", "noopener");
    pending.then(async (file) => {
      if (file && navigator.canShare({ files: [file], text })) {
        try {
          await navigator.share({ files: [file], text });
          return closeSheet();
        } catch (e) {
          if (e.name === "AbortError") return;
        }
      }
      location.href = wa;
    });
  };
  body.querySelector("#shTo").onsubmit = (e) => {
    e.preventDefault();
    const to = e.currentTarget.elements.phone.value;
    if (digits(to).length < 8) return notify("Escribe el número con código de área.", true);
    window.open(waLink(to, text), "_blank", "noopener");
  };
  body.querySelector("#shNative").onclick = async () => {
    try {
      const file = pending ? await pending : null;
      const data = file && navigator.canShare?.({ files: [file] }) ? { files: [file], text } : { title: title(v), text, url: publicLink(v.id) };
      if (navigator.share) await navigator.share(data);
      else await copy(publicLink(v.id));
    } catch (e) {
      if (e.name !== "AbortError") notify("No se pudo compartir. Usa «Copiar enlace».", true);
    }
  };
  body.querySelector("#shCopy").onclick = () => copy(publicLink(v.id));
}

export async function copy(textToCopy, done = "Enlace copiado.") {
  try {
    await navigator.clipboard.writeText(textToCopy);
    notify(done);
  } catch {
    window.prompt("Copia el enlace:", textToCopy);
  }
}
