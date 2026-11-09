// Los códigos que ve el equipo. Ninguno se guarda: salen del id al servir el
// documento, así nunca hay dos iguales ni una columna que se desincronice del id
// (el mismo criterio que "PED-000123" en Pedidos y "CASO-000123" en Casos).
function code(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(6, "0")}`;
}

export const orderCode = (id: number): string => code("PED", id);
export const purchaseRequestCode = (id: number): string => code("PC", id);
export const purchaseOrderCode = (id: number): string => code("OC", id);
export const receiptCode = (id: number): string => code("REC", id);
export const shipmentCode = (id: number): string => code("DES", id);
export const returnCode = (id: number): string => code("DEV", id);
export const creditNoteCode = (id: number): string => code("NC", id);
export const adjustmentCode = (id: number): string => code("AJ", id);
export const transferCode = (id: number): string => code("TR", id);

/** El id que trae un término de búsqueda ("PED-000123", "oc 45", "123"), o null. */
export function idFromSearch(term: string): number | null {
  const digits = term.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return null;
  const id = Number(digits);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}
