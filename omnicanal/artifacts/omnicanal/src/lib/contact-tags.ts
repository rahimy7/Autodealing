const STANDARD_LABELS: Record<string, string> = {
  lead: "Lead", vip: "VIP", in_process: "En Proceso", support: "Soporte",
};
const CHURCH_LABELS: Record<string, string> = {
  // Keep the existing key: current contacts and campaign filters keep matching.
  lead: "Ancianos", jovenes: "Jóvenes", junta: "Junta", visitas: "Visitas", miembros: "Miembros",
};
export function contactTagsForClient(clientId: string) {
  const visible = clientId === "linaje-real" ? CHURCH_LABELS : STANDARD_LABELS;
  return {
    labels: { ...STANDARD_LABELS, ...visible },
    options: Object.entries(visible).map(([value, label]) => ({ value, label })),
  };
}
