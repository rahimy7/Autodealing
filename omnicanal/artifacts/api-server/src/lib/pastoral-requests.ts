export const PASTORAL_TYPES = ["prayer_request", "visitation", "bible_study", "worship"] as const;
export type PastoralType = (typeof PASTORAL_TYPES)[number];
export const PASTORAL_LABELS: Record<PastoralType, string> = {
  prayer_request: "Petición de oración", visitation: "Visitación", bible_study: "Estudio bíblico", worship: "Culto",
};

// Register explicit requests, not every mention of worship or prayer. A question
// about service hours is information-seeking and must not become a new request.
export function detectPastoralRequest(text: string): { type: PastoralType; subject: string } | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bno (quiero|necesito|deseo|solicito)\b/.test(normalized)) return null;
  const intent = /\b(quiero|necesito|deseo|solicito|pido|quisiera|me gustaria|pueden|podrian)\b/.test(normalized);
  let type: PastoralType | null = null;
  if (/\b(peticion de oracion|oren por|orad por|pido oracion)\b/.test(normalized) || intent && /\b(oracion|orar por)\b/.test(normalized) && !/\b(informacion|horario|a que hora)\b/.test(normalized)) type = "prayer_request";
  else if (intent && /\b(visitacion|visita pastoral|me visiten|visitarme|una visita)\b/.test(normalized)) type = "visitation";
  else if (intent && /\b(estudio[s]? biblico[s]?|estudiar la biblia|estudiar biblia)\b/.test(normalized) && !/\b(horario|a que hora)\b/.test(normalized)) type = "bible_study";
  else if (intent && /\bculto\b/.test(normalized) && !/\b(horario|a que hora|informacion)\b/.test(normalized)) type = "worship";
  return type ? { type, subject: PASTORAL_LABELS[type] } : null;
}
