// The site's immersive look (css/styles.css): near-black, glass surfaces, Unbounded for display
// type and Manrope for text, the cyan → violet → magenta accent.
export const colors = {
  bg: "#05060a",
  bg2: "#090b11",
  bg3: "#0f121a",
  surface: "rgba(255,255,255,0.045)",
  surface2: "rgba(255,255,255,0.08)",
  surface3: "rgba(255,255,255,0.12)",
  solid: "#0d1017",
  line: "rgba(255,255,255,0.10)",
  line2: "rgba(255,255,255,0.18)",
  text: "#eef1f6",
  text2: "#c2c8d4",
  muted: "#8a92a5",
  accent: "#38e1ff",
  accent2: "#7c5cff",
  accent3: "#ff4fd8",
  accentInk: "#001419",
  good: "#3ddc97",
  warn: "#ffc857",
  bad: "#ff5d6c",
  info: "#8fb4ff",
  wa: "#25d366",
  ig: "#ff6fd8",
  fb: "#7d9bff",
} as const;

export const gradient = ["#38e1ff", "#7c5cff", "#ff4fd8"] as const;

export const radius = { sm: 12, md: 16, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const font = {
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semi: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  black: "Manrope_800ExtraBold",
  display: "Unbounded_600SemiBold",
  displayMedium: "Unbounded_500Medium",
} as const;
