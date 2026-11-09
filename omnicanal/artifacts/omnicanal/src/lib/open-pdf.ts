import { customFetch } from "@workspace/api-client-react";

/**
 * Baja un PDF con la sesión (el enlace directo no lleva el token) y lo abre en otra
 * pestaña; si el navegador bloquea la ventana, lo descarga.
 */
export async function openPdf(url: string, filename: string): Promise<void> {
  const blob = await customFetch<Blob>(url, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  if (!window.open(objectUrl, "_blank")) {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
