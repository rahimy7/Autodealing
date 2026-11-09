// Versión del core: lo que comparten todas las instancias. Se sube aquí al
// publicar una versión (y se etiqueta el commit con `v<versión>`), de modo que
// cada instancia pueda decir en /api/config con qué core está corriendo y se
// vea de un vistazo quién está atrasado.
//
// Mayor: cambio que exige intervención al actualizar (migración manual, nueva
// variable obligatoria). Menor: módulo o función nueva. Parche: corrección.
export const CORE_VERSION = "1.0.0";
