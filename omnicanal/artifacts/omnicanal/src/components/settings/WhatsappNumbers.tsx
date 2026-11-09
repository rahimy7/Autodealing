import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWhatsappNumbers,
  useSaveWhatsappNumbers,
  useDiscoverWhatsappNumbers,
  useDeleteWhatsappNumber,
  getListWhatsappNumbersQueryKey,
  type WhatsappNumber,
  type WhatsappNumbersInputNumbersItem,
} from "@workspace/api-client-react";
import { SiWhatsapp } from "react-icons/si";
import { Loader2, Search, Save, Star, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

// Los números por los que atiende la instancia. La bandeja marca cada
// conversación con el número que la recibió y contesta por ese mismo, así que
// esta lista es lo que decide qué líneas existen.
//
// Los números se traen de Meta en vez de teclearse: el Phone Number ID es una
// cadena de 15 dígitos que no se puede verificar a ojo, y un dígito cambiado no
// da error al guardar — se descubre cuando un cliente no recibe la respuesta.

type Draft = {
  phoneNumberId: string;
  displayNumber: string;
  verifiedName: string;
  label: string;
  isPrimary: boolean;
  isActive: boolean;
};

function toDraft(n: WhatsappNumber): Draft {
  return {
    phoneNumberId: n.phoneNumberId,
    displayNumber: n.displayNumber ?? "",
    verifiedName: n.verifiedName ?? "",
    label: n.label ?? "",
    isPrimary: n.isPrimary,
    isActive: n.isActive,
  };
}

export function WhatsappNumbers() {
  const { data, isLoading } = useListWhatsappNumbers();
  const save = useSaveWhatsappNumbers();
  const discover = useDiscoverWhatsappNumbers();
  const remove = useDeleteWhatsappNumber();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const saved = data?.numbers ?? [];
  // Los añadidos por descubrimiento que todavía no se han guardado. Se muestran
  // junto a los guardados para que el usuario les ponga etiqueta antes de grabar.
  const [pending, setPending] = useState<Draft[]>([]);
  // Ediciones sobre los guardados, por phoneNumberId.
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({});

  const rows: Draft[] = [
    ...saved.map((n) => ({ ...toDraft(n), ...edits[n.phoneNumberId] })),
    ...pending,
  ];

  function editRow(phoneNumberId: string, patch: Partial<Draft>) {
    if (pending.some((p) => p.phoneNumberId === phoneNumberId)) {
      setPending((ps) => ps.map((p) => (p.phoneNumberId === phoneNumberId ? { ...p, ...patch } : p)));
      return;
    }
    setEdits((e) => ({ ...e, [phoneNumberId]: { ...e[phoneNumberId], ...patch } }));
  }

  // Solo uno puede ser el principal: marcarlo aquí desmarca al resto, para que no
  // se guarde un estado que el servidor tendría que corregir por su cuenta.
  function makePrimary(phoneNumberId: string) {
    setEdits((e) => {
      const next = { ...e };
      for (const n of saved) {
        next[n.phoneNumberId] = { ...next[n.phoneNumberId], isPrimary: n.phoneNumberId === phoneNumberId };
      }
      return next;
    });
    setPending((ps) => ps.map((p) => ({ ...p, isPrimary: p.phoneNumberId === phoneNumberId })));
  }

  async function handleDiscover() {
    try {
      const result = await discover.mutateAsync();
      if (!result.ok) {
        toast({
          title: "Meta no devolvió los números",
          description: result.error ?? "Revisa el WABA ID y el token en la tarjeta de arriba.",
          variant: "destructive",
        });
        return;
      }
      const found = result.numbers ?? [];
      const nuevos = found.filter((n) => !n.alreadyAdded && !pending.some((p) => p.phoneNumberId === n.phoneNumberId));
      if (nuevos.length === 0) {
        toast({
          title: "Sin números nuevos",
          description: `Meta reporta ${found.length} número(s) y ya están todos dados de alta.`,
        });
        return;
      }
      setPending((ps) => [
        ...ps,
        ...nuevos.map((n) => ({
          phoneNumberId: n.phoneNumberId,
          displayNumber: n.displayNumber ?? "",
          verifiedName: n.verifiedName ?? "",
          // El nombre verificado de Meta es el mejor punto de partida para la
          // etiqueta interna; el usuario la cambia si quiere.
          label: n.verifiedName ?? "",
          isPrimary: false,
          isActive: true,
        })),
      ]);
      toast({
        title: `${nuevos.length} número(s) encontrado(s)`,
        description: "Ponles nombre y guarda para empezar a atender por ellos.",
      });
    } catch (err) {
      toast({
        title: "No se pudo consultar a Meta",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  async function handleSave() {
    const numbers: WhatsappNumbersInputNumbersItem[] = rows.map((r) => ({
      phoneNumberId: r.phoneNumberId,
      displayNumber: r.displayNumber || null,
      verifiedName: r.verifiedName || null,
      label: r.label || null,
      isPrimary: r.isPrimary,
      isActive: r.isActive,
    }));
    try {
      await save.mutateAsync({ data: { numbers } });
      await queryClient.invalidateQueries({ queryKey: getListWhatsappNumbersQueryKey() });
      setPending([]);
      setEdits({});
      toast({ title: "Números guardados", description: "La bandeja ya responde por el número que recibe." });
    } catch (err) {
      toast({
        title: "No se pudieron guardar",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(row: Draft) {
    const stored = saved.find((n) => n.phoneNumberId === row.phoneNumberId);
    if (!stored) {
      setPending((ps) => ps.filter((p) => p.phoneNumberId !== row.phoneNumberId));
      return;
    }
    try {
      await remove.mutateAsync({ id: stored.id });
      await queryClient.invalidateQueries({ queryKey: getListWhatsappNumbersQueryKey() });
      toast({ title: "Número eliminado" });
    } catch (err) {
      toast({
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  const dirty = pending.length > 0 || Object.keys(edits).length > 0;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid="whatsapp-numbers">
      <div className="px-4 sm:px-5 py-4 border-b border-card-border flex items-center gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center">
          <SiWhatsapp className="w-4.5 h-4.5" style={{ color: "#25D366" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Números de WhatsApp</h3>
          <p className="text-[11px] text-muted-foreground">
            Cada conversación se responde por el número que la recibió
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDiscover}
          disabled={discover.isPending}
          data-testid="button-discover-numbers"
        >
          {discover.isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5 mr-2" />
          )}
          Buscar números en Meta
        </Button>
      </div>

      <div className="p-5 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <Plus className="w-5 h-5 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No hay números dados de alta. Guarda el WABA ID y el token arriba, y pulsa
              <span className="font-medium text-foreground"> Buscar números en Meta</span>.
            </p>
          </div>
        ) : (
          rows.map((row) => {
            const isNew = pending.some((p) => p.phoneNumberId === row.phoneNumberId);
            return (
              <div
                key={row.phoneNumberId}
                className={`rounded-lg border p-4 space-y-3 ${
                  isNew ? "border-primary/40 bg-primary/5" : "border-card-border"
                }`}
                data-testid={`number-row-${row.phoneNumberId}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {row.displayNumber || row.phoneNumberId}
                      {row.isPrimary && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal text-primary">
                          <Star className="w-3 h-3 fill-current" /> principal
                        </span>
                      )}
                      {isNew && (
                        <span className="ml-2 text-[10px] font-normal text-primary">sin guardar</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {row.phoneNumberId}
                      {row.verifiedName ? ` · ${row.verifiedName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground">Activo</Label>
                    <Switch
                      checked={row.isActive}
                      onCheckedChange={(v) => editRow(row.phoneNumberId, { isActive: v })}
                      data-testid={`toggle-active-${row.phoneNumberId}`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-foreground/70">Nombre interno</Label>
                    <Input
                      value={row.label}
                      onChange={(e) => editRow(row.phoneNumberId, { label: e.target.value })}
                      placeholder="Ventas"
                      className="text-sm"
                      data-testid={`input-label-${row.phoneNumberId}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-foreground/70">Número visible</Label>
                    <Input
                      value={row.displayNumber}
                      onChange={(e) => editRow(row.phoneNumberId, { displayNumber: e.target.value })}
                      placeholder="+1 809 555 0100"
                      className="text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => makePrimary(row.phoneNumberId)}
                    disabled={row.isPrimary}
                    data-testid={`button-primary-${row.phoneNumberId}`}
                  >
                    <Star className="w-3.5 h-3.5 mr-2" />
                    {row.isPrimary ? "Es el principal" : "Marcar principal"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(row)}
                    data-testid={`button-delete-${row.phoneNumberId}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Eliminar
                  </Button>
                </div>
              </div>
            );
          })
        )}

        {rows.length > 0 && (
          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={save.isPending || !dirty}
              data-testid="button-save-numbers"
            >
              {save.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-2" />
              )}
              Guardar números
            </Button>
            <p className="text-[10px] text-muted-foreground">
              El principal se usa para las campañas sin número elegido y para lo que el negocio inicia.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
