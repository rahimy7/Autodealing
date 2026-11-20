// Formatting shared by every screen (ported from ventas/core.js).
export const TZ = "America/New_York";
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n: unknown) => money0.format(Number(n) || 0);
export const usd2 = (n: unknown) => money2.format(Number(n) || 0);
export const num = (n: unknown) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

export const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const nowTime = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("es-US", { ...opts, timeZone: "UTC" });
export const shortDate = (instant: string | number | Date) =>
  new Date(instant).toLocaleString("es-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
export const clock = (instant: string | number | Date) =>
  new Date(instant).toLocaleTimeString("es-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

export function ago(instant: string | number | Date) {
  const s = Math.max(0, (Date.now() - new Date(instant).getTime()) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(instant).toLocaleDateString("es-US", { timeZone: TZ, day: "numeric", month: "short" });
}
export function until(instant: string | number | Date) {
  const s = (new Date(instant).getTime() - Date.now()) / 1000;
  if (s <= 0) return "vencida";
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600);
  if (d) return `vence en ${d} d ${h} h`;
  if (h) return `vence en ${h} h`;
  return `vence en ${Math.max(1, Math.floor(s / 60))} min`;
}

export const digits = (p: unknown) => String(p ?? "").replace(/\D/g, "");
export const intl = (p: unknown) => {
  const d = digits(p);
  return d.length === 10 ? "1" + d : d;
};
export const telUrl = (p: unknown) => (digits(p).length >= 7 ? `tel:+${intl(p)}` : "");
export const waUrl = (p: unknown, text = "") =>
  `https://wa.me/${digits(p).length >= 8 ? intl(p) : ""}${text ? "?text=" + encodeURIComponent(text) : ""}`;
export const hasPhone = (p: unknown) => digits(p).length >= 8;
export const initials = (name: unknown) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export interface Vehicle {
  id: string;
  stock: string;
  vin: string;
  status: "draft" | "available" | "reserved" | "sold" | "archived";
  year: number;
  make: string;
  model: string;
  trim?: string;
  price: number;
  msrp?: number;
  priceOnRequest?: boolean;
  miles: number;
  condition?: string;
  cats?: string[];
  engine?: string;
  hp?: number;
  drive?: string;
  trans?: string | { es?: string; en?: string };
  seats?: number | null;
  fuel?: string;
  ext?: string | { es?: string; en?: string };
  int?: string | { es?: string; en?: string };
  desc?: { es?: string; en?: string };
  economy?: string;
  featured?: boolean;
  demo?: boolean;
  createdAt: string;
  photos: any[];
  version?: number;
  purchaseCost?: number;
  intakeName?: string | null;
  intakeNotes?: string;
  intakeBy?: string | null;
  reservation?: { id: string; sellerId: string; sellerName: string; expiresAt: string; mine: boolean; customerName?: string } | null;
}
export const title = (v: Partial<Vehicle>) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
export const hasPrice = (v: Partial<Vehicle>) => !v.priceOnRequest && Number(v.price) > 0;
export const priceText = (v: Partial<Vehicle>) => (hasPrice(v) ? usd(v.price) : "Consultar precio");
export const localized = (x: unknown): string =>
  typeof x === "string" ? x : (x as any)?.es || (x as any)?.en || "";
