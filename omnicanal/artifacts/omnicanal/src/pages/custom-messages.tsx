import { useEffect, useRef, useState } from "react";
import {
  useListCustomMessages,
  useListCustomMessageImages,
  useCreateCustomMessage,
  useUpdateCustomMessage,
  useDeleteCustomMessage,
  useActivateCustomMessage,
  getListCustomMessagesQueryKey,
  getListCustomMessageImagesQueryKey,
  customFetch,
  type CustomMessage,
  type CustomMessageButton,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Plus, Trash2, Upload, ImageIcon, X, Check } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

// Límites de WhatsApp para mensajes interactivos; el resto de canales los
// respeta para que un mensaje se componga una vez y se vea igual en todos.
const MAX_BUTTONS = 3;
const MAX_LABEL = 20;
const MAX_BODY = 1024;

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", Icon: SiWhatsapp, color: "text-[#25D366]" },
  { id: "instagram", label: "Instagram", Icon: SiInstagram, color: "text-[#E1306C]" },
  { id: "facebook", label: "Facebook", Icon: SiFacebook, color: "text-[#1877F2]" },
];

type Draft = {
  name: string;
  body: string;
  imagePath: string | null;
  buttons: CustomMessageButton[];
  channels: string[];
};

const EMPTY: Draft = { name: "", body: "", imagePath: null, buttons: [], channels: [] };

// Un id estable a partir de la etiqueta: es lo que Meta devuelve al pulsar.
function idFromLabel(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `opcion-${index + 1}`;
}

export default function CustomMessagesPage() {
  const { data: messages, isLoading } = useListCustomMessages();
  const { data: images } = useListCustomMessageImages();
  const createMessage = useCreateCustomMessage();
  const updateMessage = useUpdateCustomMessage();
  const deleteMessage = useDeleteCustomMessage();
  const activateMessage = useActivateCustomMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<CustomMessage | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(
      editing
        ? {
            name: editing.name,
            body: editing.body,
            imagePath: editing.imagePath ?? null,
            buttons: editing.buttons,
            channels: editing.channels,
          }
        : EMPTY,
    );
  }, [open, editing]);

  // La imagen se previsualiza con la URL firmada que devuelve el API: una <img>
  // no manda el token, así que /api/media daría 401.
  const previewUrl = draft.imagePath
    ? ((images ?? []).find((i) => i.path === draft.imagePath)?.url ??
       (editing?.imagePath === draft.imagePath ? editing?.imageUrl : null))
    : null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCustomMessagesQueryKey() });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (m: CustomMessage) => {
    setEditing(m);
    setOpen(true);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await customFetch<{ path: string; url: string }>(
        `/api/custom-messages/images?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file, headers: { "content-type": file.type } },
      );
      setDraft((d) => ({ ...d, imagePath: result.path }));
      queryClient.invalidateQueries({ queryKey: getListCustomMessageImagesQueryKey() });
      toast({ title: "Imagen subida" });
    } catch {
      toast({ title: "No se pudo subir la imagen", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    if (!draft.name.trim() || !draft.body.trim()) {
      toast({ title: "Falta el nombre o el texto del mensaje", variant: "destructive" });
      return;
    }
    const payload = {
      name: draft.name.trim(),
      body: draft.body.trim(),
      imagePath: draft.imagePath,
      buttons: draft.buttons.filter((b) => b.label.trim()),
      channels: draft.channels,
    };
    const done = {
      onSuccess: () => {
        invalidate();
        setOpen(false);
        toast({ title: editing ? "Mensaje actualizado" : "Mensaje creado" });
      },
      onError: () => toast({ title: "No se pudo guardar", variant: "destructive" }),
    };
    if (editing) updateMessage.mutate({ id: editing.id, data: payload }, done);
    else createMessage.mutate({ data: { ...payload, kind: "welcome" } }, done);
  };

  const toggleActive = (m: CustomMessage) => {
    activateMessage.mutate(
      { id: m.id, data: { isActive: !m.isActive } },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: m.isActive ? "Mensaje desactivado" : "Mensaje activado",
            description: m.isActive
              ? "Los agentes virtuales vuelven a saludar."
              : "Será el saludo por defecto en cada conversación nueva.",
          });
        },
      },
    );
  };

  const remove = (m: CustomMessage) => {
    deleteMessage.mutate(
      { id: m.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Mensaje eliminado" });
        },
      },
    );
  };

  const setButton = (i: number, label: string) =>
    setDraft((d) => {
      const buttons = [...d.buttons];
      buttons[i] = { id: idFromLabel(label, i), label: label.slice(0, MAX_LABEL) };
      return { ...d, buttons };
    });

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Mensajes personalizados</h1>
            <p className="text-sm text-muted-foreground">
              Mensajes escritos por ti que se envían tal cual. El que actives será el saludo por defecto.
            </p>
          </div>
          <Button onClick={openNew} className="gap-2" data-testid="button-new-custom-message">
            <Plus className="w-4 h-4" /> Nuevo mensaje
          </Button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando mensajes...</div>
        ) : (messages ?? []).length === 0 ? (
          <div className="p-12 text-center" data-testid="custom-messages-empty">
            <MessageSquarePlus className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Todavía no hay mensajes personalizados.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="custom-messages-list">
            {(messages ?? []).map((m) => (
              <div
                key={m.id}
                className={`bg-card border rounded-xl overflow-hidden flex flex-col ${
                  m.isActive ? "border-primary/60" : "border-card-border"
                }`}
                data-testid={`custom-message-${m.id}`}
              >
                {m.imageUrl && (
                  <img
                    src={m.imageUrl}
                    alt={m.name}
                    className="w-full h-40 object-cover bg-muted/20"
                  />
                )}
                <div className="p-4 space-y-3 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-foreground text-sm">{m.name}</div>
                    {m.isActive && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/20 text-primary whitespace-nowrap">
                        Activo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap flex-1">{m.body}</p>
                  {m.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.buttons.map((b) => (
                        <span
                          key={b.id}
                          className="text-[10px] px-2 py-1 rounded-md border border-card-border text-muted-foreground"
                        >
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-card-border/50">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Switch
                        checked={m.isActive}
                        onCheckedChange={() => toggleActive(m)}
                        data-testid={`switch-active-${m.id}`}
                      />
                      Saludo por defecto
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(m)}
                        className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground"
                        data-testid={`button-edit-${m.id}`}
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => remove(m)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-red-400"
                        data-testid={`button-delete-${m.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar mensaje" : "Nuevo mensaje personalizado"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Nombre interno</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Verano Decolor 2026"
                  data-testid="input-message-name"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">Texto</label>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {draft.body.length}/{MAX_BODY}
                  </span>
                </div>
                <Textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value.slice(0, MAX_BODY) })}
                  rows={9}
                  placeholder="¡Hola! 👋 Bienvenido a…"
                  data-testid="input-message-body"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">Botones</label>
                  <span className="text-[10px] text-muted-foreground">
                    máx. {MAX_BUTTONS} · {MAX_LABEL} caracteres
                  </span>
                </div>
                {draft.buttons.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={b.label}
                      onChange={(e) => setButton(i, e.target.value)}
                      maxLength={MAX_LABEL}
                      placeholder={`Opción ${i + 1}`}
                      data-testid={`input-button-${i}`}
                    />
                    <button
                      onClick={() => setDraft({ ...draft, buttons: draft.buttons.filter((_, j) => j !== i) })}
                      className="p-2 text-muted-foreground hover:text-red-400"
                      data-testid={`button-remove-button-${i}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {draft.buttons.length < MAX_BUTTONS && (
                  <button
                    onClick={() =>
                      setDraft({ ...draft, buttons: [...draft.buttons, { id: "", label: "" }] })
                    }
                    className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-card-border text-muted-foreground hover:text-foreground w-full"
                    data-testid="button-add-button"
                  >
                    + Añadir botón
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Canales</label>
                <div className="flex gap-2">
                  {CHANNELS.map(({ id, label, Icon, color }) => {
                    const on = draft.channels.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            channels: on
                              ? draft.channels.filter((c) => c !== id)
                              : [...draft.channels, id],
                          })
                        }
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                          on ? "border-primary/60 bg-primary/10 text-foreground" : "border-card-border text-muted-foreground"
                        }`}
                        data-testid={`toggle-channel-${id}`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${color}`} /> {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">Sin seleccionar ninguno se envía en todos.</p>
              </div>
            </div>

            {/* Imagen + vista previa */}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">Imagen</label>
                  <button
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-primary/15 text-primary disabled:opacity-50"
                    data-testid="button-upload-image"
                  >
                    <Upload className="w-3.5 h-3.5" /> {uploading ? "Subiendo..." : "Subir nueva"}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUpload(f);
                      e.target.value = "";
                    }}
                    data-testid="input-file-image"
                  />
                </div>

                <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto" data-testid="image-picker">
                  <button
                    onClick={() => setDraft({ ...draft, imagePath: null })}
                    className={`aspect-square rounded-lg border flex items-center justify-center ${
                      draft.imagePath === null ? "border-primary" : "border-card-border"
                    }`}
                    title="Sin imagen"
                    data-testid="image-option-none"
                  >
                    <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
                  </button>
                  {(images ?? []).map((img) => (
                    <button
                      key={img.path}
                      onClick={() => setDraft({ ...draft, imagePath: img.path })}
                      className={`relative aspect-square rounded-lg overflow-hidden border ${
                        draft.imagePath === img.path ? "border-primary" : "border-card-border"
                      }`}
                      data-testid={`image-option-${img.path}`}
                    >
                      <img src={img.url} alt={img.path} className="w-full h-full object-cover" />
                      {draft.imagePath === img.path && (
                        <span className="absolute inset-0 bg-primary/25 flex items-center justify-center">
                          <Check className="w-4 h-4 text-primary" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Vista previa</label>
                <div className="bg-muted/20 border border-card-border rounded-xl p-3 space-y-2">
                  <div className="bg-card rounded-lg overflow-hidden max-w-[280px]">
                    {previewUrl && <img src={previewUrl} alt="" className="w-full object-cover" />}
                    <p className="p-3 text-xs text-foreground whitespace-pre-wrap">
                      {draft.body || "El texto del mensaje aparecerá aquí."}
                    </p>
                    {draft.buttons.filter((b) => b.label.trim()).length > 0 && (
                      <div className="border-t border-card-border divide-y divide-card-border">
                        {draft.buttons
                          .filter((b) => b.label.trim())
                          .map((b, i) => (
                            <div key={i} className="px-3 py-2 text-center text-xs text-primary font-medium">
                              {b.label}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={createMessage.isPending || updateMessage.isPending}
              data-testid="button-save-message"
            >
              {editing ? "Guardar cambios" : "Crear mensaje"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
