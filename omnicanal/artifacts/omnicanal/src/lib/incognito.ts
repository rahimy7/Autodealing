import { useSyncExternalStore } from "react";
import { useAuth } from "./auth";

/**
 * Modo incógnito del administrador: abrir un chat, un correo o un hilo de
 * comentarios no lo marca como leído, así que el contador sigue ahí para quien
 * lo atiende. Se resuelve en el panel —simplemente no se manda el acuse— y se
 * guarda en este navegador, igual que la campana de avisos.
 *
 * Es cosa del rol: con sesión de agente nunca cuenta, aunque en este navegador
 * se haya dejado encendido.
 */
const STORAGE_KEY = "omniai_incognito";

const listeners = new Set<() => void>();
let enabled = localStorage.getItem(STORAGE_KEY) === "on";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setIncognito(next: boolean) {
  localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  enabled = next;
  listeners.forEach((l) => l());
}

/** Si lo que se abra ahora debe quedarse como no leído. */
export function useIncognito(): boolean {
  const { user } = useAuth();
  const stored = useSyncExternalStore(subscribe, () => enabled);
  return user?.role === "admin" && stored;
}
