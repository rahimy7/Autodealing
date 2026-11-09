import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateViewAccess, getListViewAccessQueryKey } from "@workspace/api-client-react";
import {
  DEFAULT_VIEWS_BY_ROLE,
  VIEWS,
  VIEW_GROUPS,
  VIEW_GROUP_LABELS,
  VIEW_KEYS,
  type ViewKey,
} from "@workspace/platform-config";
import { LayoutList, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useModules } from "@/lib/platform";
import { cn } from "@/lib/utils";

export interface ViewAccessTarget {
  id: number;
  name: string;
  role: "admin" | "agent";
  views: string[];
}

/**
 * Elige qué vistas del panel abre una persona. No depende de su rol: el rol solo
 * propone el punto de partida (los botones de plantilla); lo que se guarda aquí es
 * lo que la persona ve en el menú y lo que el servidor le deja usar.
 */
export function ViewAccessDialog({ target, onClose }: { target: ViewAccessTarget | null; onClose: () => void }) {
  const modules = useModules();
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateViewAccess();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(target?.views ?? []));
  }, [target]);

  // Solo se ofrecen las vistas cuyo módulo la instancia tiene. Las demás que la
  // persona ya tuviera se conservan al guardar: apagar un módulo no debe borrar el
  // acceso de quien lo vuelva a tener cuando se encienda.
  const offered = useMemo(
    () => new Set(VIEW_KEYS.filter((key) => !VIEWS[key].module || modules[VIEWS[key].module!])),
    [modules],
  );
  const groups = useMemo(
    () =>
      VIEW_GROUPS.map((group) => ({
        group,
        keys: VIEW_KEYS.filter((key) => VIEWS[key].group === group && offered.has(key)),
      })).filter((g) => g.keys.length > 0),
    [offered],
  );

  const isSelf = !!target && target.id === user?.agentId;
  // Quitarse Administración es quedarse sin forma de devolver el acceso.
  const locked = (key: ViewKey) => isSelf && key === "admin";

  const set = (keys: readonly ViewKey[]) => setSelected(new Set(keys.filter((key) => offered.has(key) || locked(key))));
  const toggle = (key: ViewKey, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleGroup = (keys: ViewKey[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (locked(key)) continue;
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const offeredSelected = VIEW_KEYS.filter((key) => offered.has(key) && selected.has(key));
  const keptHidden = (target?.views ?? []).filter((key) => !offered.has(key as ViewKey));
  const total = offeredSelected.length + keptHidden.length;

  const save = () => {
    if (!target) return;
    update.mutate(
      { agentId: target.id, data: { views: [...offeredSelected, ...keptHidden] } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListViewAccessQueryKey() });
          if (isSelf) void refresh();
          toast({
            title: "Vistas actualizadas",
            description: `${target.name} verá ${total} ${total === 1 ? "vista" : "vistas"}. Los cambios le llegan en menos de un minuto.`,
          });
          onClose();
        },
        onError: (err) => {
          const message = (err as { data?: { error?: string } }).data?.error;
          toast({ title: "No se pudo guardar", description: message ?? "Intenta de nuevo.", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutList className="w-4 h-4 text-primary" /> Vistas de {target?.name}
          </DialogTitle>
          <DialogDescription>
            Marca las pantallas que esta persona puede abrir. No depende de su rol: lo que marques aquí es lo que verá en el menú.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" data-testid="view-access-presets">
          <Button type="button" size="sm" variant="outline" onClick={() => set(VIEW_KEYS)}>
            Todas
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => set(DEFAULT_VIEWS_BY_ROLE.admin)}>
            Como administrador
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => set(DEFAULT_VIEWS_BY_ROLE.agent)}>
            Como agente
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-4">
          {groups.map(({ group, keys }) => {
            const ticked = keys.filter((key) => selected.has(key)).length;
            return (
              <section key={group} data-testid={`view-group-${group}`}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {VIEW_GROUP_LABELS[group]}
                  </h3>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-primary hover:underline"
                    onClick={() => toggleGroup(keys, ticked < keys.length)}
                  >
                    {ticked < keys.length ? "Marcar grupo" : "Quitar grupo"}
                  </button>
                </div>
                <div className="rounded-xl border border-border divide-y divide-border">
                  {keys.map((key) => {
                    const view = VIEWS[key];
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex items-start gap-3 px-3 py-2.5",
                          locked(key) ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/40",
                        )}
                        data-testid={`view-row-${key}`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(key)}
                          disabled={locked(key)}
                          onCheckedChange={(checked) => toggle(key, checked === true)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                            {view.label}
                            {locked(key) && <Lock className="w-3 h-3 text-muted-foreground" aria-label="No puedes quitártela" />}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {locked(key) ? "No puedes quitarte esta vista a ti mismo." : view.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <span className="text-xs text-muted-foreground mr-auto" data-testid="view-access-count">
            {total} {total === 1 ? "vista" : "vistas"} seleccionadas
            {total === 0 && " — deja al menos una"}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={total === 0 || update.isPending} data-testid="button-save-views">
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
