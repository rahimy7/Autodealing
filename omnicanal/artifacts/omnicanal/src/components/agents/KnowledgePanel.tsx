import { useState } from "react";
import {
  useListKnowledgeBases,
  useCreateKnowledgeBase,
  useUpdateKnowledgeBase,
  useDeleteKnowledgeBase,
  useAssistKnowledgeQuestion,
  getListKnowledgeBasesQueryKey,
  type KnowledgeBase,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Brain, Trash2, Pencil, Wand2, Loader2, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  parseKnowledgeContent,
  serializeKnowledgeContent,
  categoriesOf,
  matchesFilter,
  newQaItem,
  type QaItem,
} from "@/lib/knowledge-qa";

const CATEGORY_DATALIST_ID = "kb-category-suggestions";

function QaRow({
  item,
  categories,
  onChange,
  onRemove,
  onAssist,
  assisting,
}: {
  item: QaItem;
  categories: string[];
  onChange: (patch: Partial<QaItem>) => void;
  onRemove: () => void;
  onAssist: () => void;
  assisting: boolean;
}) {
  return (
    <div className="bg-muted/40 border border-card-border rounded-lg p-3 space-y-2" data-testid={`kb-qa-row-${item.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Textarea
              value={item.question}
              onChange={(e) => onChange({ question: e.target.value })}
              placeholder="¿Cuál es la pregunta?"
              rows={1}
              className="text-sm min-h-9 resize-none py-2"
              data-testid={`input-kb-question-${item.id}`}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-9 w-9 flex-shrink-0"
              title="Mejorar redacción y clasificar con IA"
              onClick={onAssist}
              disabled={assisting}
              data-testid={`button-assist-question-${item.id}`}
            >
              {assisting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4 text-primary" />}
            </Button>
          </div>
          <Textarea
            value={item.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            placeholder="Respuesta"
            rows={2}
            className="text-sm resize-none"
            data-testid={`input-kb-answer-${item.id}`}
          />
          <Input
            value={item.category}
            onChange={(e) => onChange({ category: e.target.value })}
            placeholder="Categoría (opcional) — agrupa esta pregunta con otras del mismo tema"
            list={CATEGORY_DATALIST_ID}
            className="h-7 text-xs"
            data-testid={`input-kb-category-${item.id}`}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-muted-foreground hover:text-red-400 flex-shrink-0"
          title="Quitar pregunta"
          data-testid={`button-remove-question-${item.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {categories.length > 0 && (
        <datalist id={CATEGORY_DATALIST_ID}>
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      )}
    </div>
  );
}

export default function KnowledgePanel() {
  const { data: kbs, isLoading } = useListKnowledgeBases();
  const createKb = useCreateKnowledgeBase();
  const updateKb = useUpdateKnowledgeBase();
  const deleteKb = useDeleteKnowledgeBase();
  const assistQuestion = useAssistKnowledgeQuestion();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Modo preguntas y respuestas: cada fila es una pregunta editable por su
  // cuenta, con su categoría — así se filtran y se agrupan al guardar. Modo
  // texto libre: el `content` de siempre, para lo que no encaja como pregunta.
  const [mode, setMode] = useState<"qa" | "texto">("qa");
  const [preamble, setPreamble] = useState("");
  const [extras, setExtras] = useState("");
  const [items, setItems] = useState<QaItem[]>([]);
  const [rawContent, setRawContent] = useState("");
  const [filter, setFilter] = useState("");
  const [assistingId, setAssistingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });

  const openNew = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setMode("qa");
    setPreamble("");
    setExtras("");
    setItems([newQaItem()]);
    setRawContent("");
    setFilter("");
    setOpen(true);
  };

  const openEdit = (k: KnowledgeBase) => {
    setEditing(k);
    setName(k.name);
    setDescription(k.description ?? "");
    const parsed = parseKnowledgeContent(k.content ?? "");
    setPreamble(parsed.preamble);
    setExtras(parsed.extras);
    setItems(parsed.items.length ? parsed.items : [newQaItem()]);
    setRawContent(k.content ?? "");
    setMode(parsed.items.length > 0 ? "qa" : "texto");
    setFilter("");
    setOpen(true);
  };

  // Cambiar de pestaña convierte de una representación a la otra, así que las
  // dos siempre reflejan lo último que se editó, se haya tocado o no esa pestaña.
  const switchMode = (next: string) => {
    if (next === mode) return;
    if (next === "texto") {
      setRawContent(serializeKnowledgeContent({ preamble, items, extras }));
    } else {
      const parsed = parseKnowledgeContent(rawContent);
      setPreamble(parsed.preamble);
      setExtras(parsed.extras);
      setItems(parsed.items.length ? parsed.items : [newQaItem()]);
    }
    setMode(next as "qa" | "texto");
  };

  const updateItem = (id: string, patch: Partial<QaItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id: string) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  const addItem = () => setItems((prev) => [...prev, newQaItem(prev.at(-1)?.category ?? "")]);

  const runAssist = async (item: QaItem) => {
    if (!item.question.trim()) {
      toast({ title: "Escribe la pregunta primero", variant: "destructive" });
      return;
    }
    setAssistingId(item.id);
    try {
      const r = await assistQuestion.mutateAsync({
        data: { question: item.question, answer: item.answer.trim() || null, categories: categoriesOf(items) },
      });
      updateItem(item.id, { question: r.question, category: r.category });
      if (!r.ok) toast({ title: "No se pudo mejorar con IA", description: r.message ?? undefined });
    } finally {
      setAssistingId(null);
    }
  };

  const submit = () => {
    if (!name.trim()) return;
    const content = mode === "qa" ? serializeKnowledgeContent({ preamble, items, extras }) : rawContent;
    const data = { name: name.trim(), description: description.trim() || null, content };
    if (editing) updateKb.mutate({ id: editing.id, data }, { onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Base actualizada" }); } });
    else createKb.mutate({ data }, { onSuccess: () => { invalidate(); setOpen(false); toast({ title: "Base creada" }); } });
  };

  const remove = (id: number) => deleteKb.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Base eliminada" }); } });

  const categories = categoriesOf(items);
  const visibleItems = filter.trim() ? items.filter((it) => matchesFilter(it, filter)) : items;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Documentos que los agentes consultan al responder (enlazados desde sus capacidades).</p>
        <Button size="sm" onClick={openNew} className="gap-2" data-testid="button-new-kb"><Plus className="w-4 h-4" /> Nueva base</Button>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-card border border-card-border animate-pulse" />)}</div>
      ) : (kbs ?? []).length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-10 text-center">
          <Brain className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aún no hay bases de conocimiento</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(kbs ?? []).map((k) => {
            const kCount = parseKnowledgeContent(k.content ?? "").items.length;
            return (
              <div key={k.id} className="bg-card border border-card-border rounded-xl p-4" data-testid={`kb-card-${k.id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Brain className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    <span className="text-sm font-semibold text-foreground truncate">{k.name}</span>
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button onClick={() => openEdit(k)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`edit-kb-${k.id}`}><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(k.id)} className="p-1 text-muted-foreground hover:text-red-400" data-testid={`delete-kb-${k.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {k.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{k.description}</p>}
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  {kCount > 0 ? `${kCount} pregunta${kCount === 1 ? "" : "s"}` : `${(k.content ?? "").length} caracteres`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>{editing ? "Editar base de conocimiento" : "Nueva base de conocimiento"}</DialogTitle></DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1 -mr-1">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="text-sm font-medium">Nombre</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Preguntas frecuentes" data-testid="input-kb-name" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Descripción (opcional)</label><Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-kb-description" /></div>
            </div>

            <Tabs value={mode} onValueChange={switchMode}>
              <TabsList>
                <TabsTrigger value="qa" data-testid="tab-kb-qa">Preguntas y respuestas</TabsTrigger>
                <TabsTrigger value="texto" data-testid="tab-kb-texto">Texto libre</TabsTrigger>
              </TabsList>

              <TabsContent value="qa" className="space-y-3 mt-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Encabezado (opcional)</label>
                  <Textarea value={preamble} onChange={(e) => setPreamble(e.target.value)} rows={2} placeholder="Título o introducción del documento" className="text-sm resize-none" data-testid="input-kb-preamble" />
                </div>

                {items.length > 3 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Buscar por pregunta, respuesta o categoría…"
                      className="h-8 text-xs pl-8"
                      data-testid="input-kb-filter"
                    />
                  </div>
                )}

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {visibleItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Ninguna pregunta coincide con "{filter}".</p>
                  ) : (
                    visibleItems.map((item) => (
                      <QaRow
                        key={item.id}
                        item={item}
                        categories={categories}
                        onChange={(patch) => updateItem(item.id, patch)}
                        onRemove={() => removeItem(item.id)}
                        onAssist={() => runAssist(item)}
                        assisting={assistingId === item.id && assistQuestion.isPending}
                      />
                    ))
                  )}
                </div>

                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addItem} data-testid="button-add-question">
                  <Plus className="w-3.5 h-3.5" /> Agregar pregunta
                </Button>

                {extras.trim() && (
                  <div className="space-y-1.5 border-t border-card-border pt-3">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Contenido adicional detectado (no sigue el formato de pregunta y respuesta; se guarda igual)
                    </label>
                    <Textarea value={extras} onChange={(e) => setExtras(e.target.value)} rows={4} className="text-xs font-mono resize-none" data-testid="input-kb-extras" />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="texto" className="mt-3">
                <Textarea
                  value={rawContent}
                  onChange={(e) => setRawContent(e.target.value)}
                  rows={10}
                  placeholder="Pega aquí la información: precios, políticas, especificaciones…"
                  className={cn("text-sm")}
                  data-testid="input-kb-content"
                />
              </TabsContent>
            </Tabs>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={submit} disabled={createKb.isPending || updateKb.isPending || !name.trim()} data-testid="button-submit-kb">{editing ? "Guardar" : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
