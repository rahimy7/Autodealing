import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListContactsQueryKey, getGetContactQueryKey, getListConversationsQueryKey, customFetch, type Contact } from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function MetaContactProfile({ contact }: { contact: Contact }) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const channels = contact.channels ?? [];
  const canSync = channels.length === 1 && ["instagram", "facebook"].includes(channels[0]);
  async function sync() {
    if (loading) return;
    setLoading(true);
    try {
      await customFetch(`/api/contacts/${contact.id}/meta-profile`, { method: "POST", responseType: "json" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contact.id) }),
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }),
      ]);
      toast({ title: "Perfil actualizado desde Meta", description: "Se conservan los nombres editados por el equipo." });
    } catch (error) {
      toast({ title: "No se pudo actualizar el perfil", description: error instanceof Error ? error.message : "Intenta nuevamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {contact.instagramUsername && <span>@{contact.instagramUsername}</span>}
      {contact.metaProfileName && contact.metaProfileName !== contact.name && <span>Meta: {contact.metaProfileName}</span>}
      {canSync && <Button type="button" size="sm" variant="ghost" disabled={loading}
        aria-label={`Actualizar perfil de Meta de ${contact.name}`}
        onClick={(event) => { event.stopPropagation(); void sync(); }} className="h-7 px-2 text-xs gap-1">
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Actualizando…" : "Actualizar desde Meta"}
      </Button>}
    </div>
  );
}
