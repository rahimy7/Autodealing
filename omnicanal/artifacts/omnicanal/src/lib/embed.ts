/**
 * ¿El panel está dentro de otra página? En el sitio de Premier la administración
 * muestra las pantallas de Omnicanal dentro de su propio menú: ahí el panel no
 * pinta el suyo (ni su barra lateral ni su cabecera móvil) y ocupa todo el marco.
 */
export const EMBEDDED: boolean = (() => {
  try {
    return window.self !== window.top;
  } catch {
    // Un navegador que niega mirar `top` es porque está en un marco de otro origen.
    return true;
  }
})();
