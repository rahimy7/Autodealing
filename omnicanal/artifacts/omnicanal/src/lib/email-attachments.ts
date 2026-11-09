import { customFetch } from "@workspace/api-client-react";

// Adjuntos salientes de un correo: se suben en cuanto se eligen (antes de que el
// correo que los va a llevar exista) y se referencian por id al responder,
// redactar o aprobar un borrador. Misma idea que sendAttachment() en media.ts
// para el chat, pero con su propio endpoint porque el archivo se guarda en
// espera en vez de adjuntarse a un mensaje ya existente.

export type StagedEmailAttachment = { id: number; filename: string; mimeType: string; size: number };

// 15 MB por archivo, igual que MAX_EMAIL_ATTACHMENT_BYTES en el servidor —
// rechazar aquí ahorra la subida completa cuando ya se sabe que va a fallar.
export const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENTS_COUNT = 10;

export async function stageEmailAttachment(file: File): Promise<StagedEmailAttachment> {
  const params = new URLSearchParams({ name: file.name, type: file.type || "application/octet-stream" });
  return customFetch<StagedEmailAttachment>(`/api/email/attachments?${params}`, {
    method: "POST",
    // Siempre octet-stream: el tipo real va en la query (igual que los adjuntos del chat).
    headers: { "content-type": "application/octet-stream" },
    body: file,
    responseType: "json",
  });
}

export async function discardEmailAttachment(id: number): Promise<void> {
  await customFetch(`/api/email/attachments/${id}`, { method: "DELETE" });
}
