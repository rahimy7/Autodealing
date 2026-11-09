// Mirrors the panel's palette (artifacts/omnicanal/src/index.css) so the phone
// and the desktop app read as the same product: teal primary, coral accent,
// near-white background.
export const colors = {
  background: "#F9F9FC",
  foreground: "#1D2030",
  card: "#FFFFFF",
  border: "#E0E0EB",
  muted: "#EFEFF5",
  mutedForeground: "#70758F",
  primary: "#0FB3AE",
  primarySoft: "#E1F6F5",
  primaryForeground: "#FFFFFF",
  accent: "#F0427C",
  accentSoft: "#FDE7EF",
  destructive: "#EB4747",
  destructiveSoft: "#FDECEC",
  warning: "#D97706",
  warningSoft: "#FEF3C7",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  info: "#2563EB",
  infoSoft: "#DBEAFE",
  bot: "#8B5CF6",
  botSoft: "#EDE9FE",
  overlay: "rgba(15, 23, 42, 0.45)",
} as const;

// El hilo de conversación, con los colores de WhatsApp: es la app que el equipo
// usa todo el día, y el panel web usa los mismos (omnicanal/src/index.css).
export const chatColors = {
  wallpaper: "#EFEAE2",
  incoming: "#FFFFFF",
  outgoing: "#D9FDD3",
  bot: "#EDE7F3",
  text: "#111B21",
  meta: "#667781",
  note: "#FFF5C4",
  noteText: "#54656F",
} as const;

export const channelColors: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  facebook: "#1877F2",
  email: "#EA4335",
};

export const channelLabels: Record<string, string> = {
  all: "Todos",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Correo",
};

// Ionicons names, so the channel badge looks the same everywhere.
export const channelIcons: Record<string, "logo-whatsapp" | "logo-instagram" | "logo-facebook" | "mail" | "chatbubble"> = {
  whatsapp: "logo-whatsapp",
  instagram: "logo-instagram",
  facebook: "logo-facebook",
  email: "mail",
};

export const statusLabels: Record<string, string> = {
  open: "Abierto",
  pending: "Pendiente",
  bot: "Bot",
  resolved: "Resuelto",
};

export const statusColors: Record<string, { bg: string; fg: string }> = {
  open: { bg: colors.infoSoft, fg: "#1D4ED8" },
  pending: { bg: colors.warningSoft, fg: "#B45309" },
  bot: { bg: colors.botSoft, fg: "#6D28D9" },
  resolved: { bg: colors.successSoft, fg: "#15803D" },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
