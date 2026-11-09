import { customFetch, type Order } from "@workspace/api-client-react";

// El comprobante y la guía de envío son adjuntos propios del pedido — mismo
// almacenamiento que los del chat, pero fuera del contrato de OpenAPI, como los
// adjuntos de correo (email-attachments.ts): el cuerpo es el archivo crudo, con
// su content-type real (el backend lo usa para elegir la extensión).
export const ORDER_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
export const MAX_ORDER_ATTACHMENT_BYTES = 15 * 1024 * 1024;

async function uploadOrderFile(orderId: number, kind: "payment-proof" | "shipping-label", file: File): Promise<Order> {
  return customFetch<Order>(`/api/orders/${orderId}/${kind}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    responseType: "json",
  });
}

export const uploadPaymentProof = (orderId: number, file: File): Promise<Order> => uploadOrderFile(orderId, "payment-proof", file);
export const uploadShippingLabel = (orderId: number, file: File): Promise<Order> => uploadOrderFile(orderId, "shipping-label", file);
