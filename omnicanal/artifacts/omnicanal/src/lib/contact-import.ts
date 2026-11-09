export type ImportContact = { name: string; phone: string | null; notes: string };
export function contactImportKey(contact: { phone?: string | null; notes?: string | null; name: string }): string {
  const digits = contact.phone?.replace(/\D/g, "");
  if (digits) return "phone:" + digits;
  const handle = contact.notes?.match(/Usuario de WhatsApp:\s*(@[^\s|]+)/i)?.[1];
  return handle ? "whatsapp:" + handle.toLowerCase() : "name:" + contact.name.trim().toLowerCase() + ":" + (contact.notes ?? "").trim();
}
export function parseContactImport(text: string): ImportContact[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 1001) throw new Error("Importa hasta 1000 contactos por lista.");
  if (lines[0]?.toLowerCase().startsWith("nombre\t")) lines.shift();
  const records = lines.map((line, index) => {
    const columns = line.split("\t");
    if (columns.length < 2 || columns.length > 3) throw new Error(`Fila ${index + 1}: usa las columnas Nombre, Teléfono y Notas separadas por tabulador.`);
    const [rawName, rawPhone, rawNotes = ""] = columns;
    const name = rawName.trim(), digits = rawPhone.replace(/\D/g, "");
    if (!name) throw new Error(`Fila ${index + 1}: falta el nombre.`);
    if (rawPhone.trim() && (!/^\+?[\d\s().-]+$/.test(rawPhone.trim()) || digits.length < 8 || digits.length > 15))
      throw new Error(`Fila ${index + 1}: el teléfono no es válido.`);
    return { name, phone: digits ? "+" + digits : null, notes: rawNotes.trim() };
  });
  const seen = new Set<string>();
  return records.filter(record => { const key = contactImportKey(record); if (seen.has(key)) return false; seen.add(key); return true; });
}
