import type { ClientConfig } from "../schema";
import { premier } from "./premier";
import { demo } from "./demo";

// Los clientes de esta copia. Es la instancia de Premier Line Motors: `demo`
// queda como cliente neutro para desarrollo y como plantilla de
// `pnpm clients:new`.
//
// Las importaciones son estáticas a propósito: así el bundle del servidor las
// incluye, el compilador valida cada archivo y un `CLIENT_ID` equivocado falla
// al arrancar en vez de a mitad de una petición.
export const CLIENTS: Record<string, ClientConfig> = {
  [premier.id]: premier,
  [demo.id]: demo,
};

export const CLIENT_IDS: string[] = Object.keys(CLIENTS).sort();

export { premier, demo };
