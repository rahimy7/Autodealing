import { VIEW_KEYS, VIEWS, type ModuleKey, type ViewGroup, type ViewKey } from "@workspace/platform-config";

export interface NavEntry {
  key: ViewKey;
  label: string;
  path: string;
  group: ViewGroup;
}

/**
 * Las entradas del menú de quien tiene `views`: las que se le asignaron y cuyo
 * módulo la instancia tiene encendido, en el orden del catálogo. Es la misma regla
 * que aplica el menú del panel (`useNavEntries`), en el servidor, para que quien
 * lo incruste —la administración del sitio de Premier— liste las mismas pantallas
 * sin conocerlas.
 */
export function navEntries(views: ReadonlySet<ViewKey>, moduleOn: (module: ModuleKey) => boolean): NavEntry[] {
  return VIEW_KEYS.filter((key) => {
    const module = VIEWS[key].module;
    return views.has(key) && (!module || moduleOn(module));
  }).map((key) => ({ key, label: VIEWS[key].label, path: VIEWS[key].path, group: VIEWS[key].group }));
}
