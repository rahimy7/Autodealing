// The catalogue is read by many screens (catalog, quotes, reservations, agenda), so it is fetched
// once and shared; anything that changes a unit's status forgets it.
import { api } from "./api";
import type { Vehicle } from "./format";

let catalog: Vehicle[] = [];
let loaded = false;
let inflight: Promise<Vehicle[]> | null = null;

export async function loadCatalog(force = false): Promise<Vehicle[]> {
  if (!force && loaded) return catalog;
  inflight ??= api<Vehicle[]>("/api/admin/catalog")
    .then((list) => {
      catalog = list;
      loaded = true;
      return list;
    })
    .finally(() => (inflight = null));
  return inflight;
}
export const cachedCatalog = () => catalog;
export const forgetCatalog = () => {
  loaded = false;
};
