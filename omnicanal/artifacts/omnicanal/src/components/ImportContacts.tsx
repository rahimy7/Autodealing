import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listContacts, createContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { parseContactImport, contactImportKey } from "@/lib/contact-import";

export default function ImportContacts() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: string[] } | null>(null);
  const [error, setError] = useState("");
  const client = useQueryClient();
  const preview = useMemo(() => {
    try { return { records: parseContactImport(text), error: "" }; }
    catch (err) { return { records: [], error: err instanceof Error ? err.message : "Lista inválida." }; }
  }, [text]);
  async function importAll() {
    if (running || !preview.records.length || preview.error) return;
    setRunning(true); setError(""); setResult(null); setProgress(0);
    let created = 0, skipped = 0;
    const failed: string[] = [];
    try {
      const existing = await listContacts();
      const known = new Set(existing.map(contactImportKey));
      for (const [index, record] of preview.records.entries()) {
        const key = contactImportKey(record);
        if (known.has(key)) { skipped++; }
        else {
          try { await createContact({ name: record.name, phone: record.phone, notes: record.notes }); known.add(key); created++; }
          catch (err) { failed.push(record.name + ": " + (err instanceof Error ? err.message : "No se pudo guardar.")); }
        }
        setProgress(index + 1);
      }
      setResult({ created, skipped, failed });
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar la lista actual de contactos."); }
    finally { await client.invalidateQueries({ queryKey: getListContactsQueryKey() }); setRunning(false); }
  }
  return <>
    <Button type="button" variant="outline" className="gap-2" onClick={() => setOpen(true)}><Upload className="h-4 w-4" />Importar contactos</Button>
    <Dialog open={open} onOpenChange={value => { if (!running) setOpen(value); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar contactos</DialogTitle>
          <DialogDescription>Pega las columnas Nombre, Teléfono y Notas desde una hoja de cálculo. Conserva la columna Teléfono vacía si solo tienes un usuario de WhatsApp. Los contactos existentes se conservan.</DialogDescription>
        </DialogHeader>
        <label htmlFor="contact-import-list" className="text-sm font-medium">Lista de contactos</label>
        <Textarea id="contact-import-list" value={text} disabled={running} rows={8} onChange={event => { setText(event.target.value); setResult(null); setError(""); }} placeholder={"Nombre\tTeléfono\tNotas"} />
        <p className="text-sm text-muted-foreground">{preview.records.length} contactos en la lista. Se omiten teléfonos o usuarios de WhatsApp ya registrados.</p>
        {(preview.error || error) && <p role="alert" className="text-sm text-destructive">{preview.error || error}</p>}
        {running && <p role="status">Procesados {progress} de {preview.records.length}…</p>}
        {result && <div role="status" className="space-y-2 text-sm">
          <p>Importación terminada: {result.created} nuevos · {result.skipped} existentes · {result.failed.length} errores.</p>
          {result.failed.length > 0 && <div className="max-h-32 overflow-auto text-destructive">{result.failed.map((failure, index) => <p key={index}>{failure}</p>)}</div>}
        </div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={running} onClick={() => setOpen(false)}>Cerrar</Button>
          <Button type="button" disabled={running || !preview.records.length || !!preview.error} onClick={() => void importAll()}>{running ? "Importando…" : "Importar lista"}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
