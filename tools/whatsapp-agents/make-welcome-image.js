// Builds the welcome picture sent with the WhatsApp greeting: the real logo on the site's dark
// background with its cyan→violet→pink accent. Output: the panel's public
// folder, omnicanal/artifacts/omnicanal/public/clients/premier/welcome.jpg (1200×628, JPEG).
//   node tools/whatsapp-agents/make-welcome-image.js
import sharp from "sharp";
import { fileURLToPath } from "node:url";
const P = fileURLToPath(new URL("../..", import.meta.url));
const W = 1200, H = 628;
const logo = await sharp(`${P}/img/premier-logo.png`).resize({ width: 760 }).png().toBuffer();
const lm = await sharp(logo).metadata();
const font = "Helvetica Neue, Helvetica, Arial, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g1" cx="50%" cy="36%" r="62%"><stop offset="0" stop-color="#1b1f33"/><stop offset="1" stop-color="#05060a"/></radialGradient>
    <radialGradient id="g2" cx="88%" cy="108%" r="55%"><stop offset="0" stop-color="#7c5cff" stop-opacity=".30"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
    <radialGradient id="g3" cx="8%" cy="-8%" r="50%"><stop offset="0" stop-color="#38e1ff" stop-opacity=".20"/><stop offset="1" stop-color="#38e1ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#38e1ff"/><stop offset=".55" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g1)"/>
  <rect width="${W}" height="${H}" fill="url(#g2)"/>
  <rect width="${W}" height="${H}" fill="url(#g3)"/>
  <text x="${W / 2}" y="468" text-anchor="middle" font-family="${font}" font-size="44" font-weight="800" letter-spacing="9" fill="#eef1f6">BIENVENIDO  ·  WELCOME</text>
  <rect x="${W / 2 - 190}" y="496" width="380" height="5" rx="2.5" fill="url(#bar)"/>
  <text x="${W / 2}" y="560" text-anchor="middle" font-family="${font}" font-size="28" font-weight="600" letter-spacing="3" fill="#9aa3b8">Paterson, New Jersey</text>
</svg>`;
const out = `${P}/omnicanal/artifacts/omnicanal/public/clients/premier/welcome.jpg`;
await sharp(Buffer.from(svg))
  .composite([{ input: logo, left: Math.round((W - lm.width) / 2), top: 60 }])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(out);
const m = await sharp(out).metadata();
console.log(out, m.width + "x" + m.height, m.format);
