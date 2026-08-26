/**
 * Semantic design tokens for the mobile budget app.
 * Light/dark supported architecturally; financial status never relies on color alone.
 */

export type ThemeMode = "light" | "dark";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34 },
  title: { fontSize: 22, fontWeight: "700" as const, lineHeight: 28 },
  headline: { fontSize: 18, fontWeight: "600" as const, lineHeight: 24 },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 22 },
  bodyStrong: { fontSize: 16, fontWeight: "600" as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "600" as const, lineHeight: 16 },
  metric: { fontSize: 24, fontWeight: "700" as const, lineHeight: 30 },
} as const;

/** Minimum recommended tap target (pt). */
export const touchTarget = 44;

type Palette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  tint: string;
  tintMuted: string;
  onTint: string;
  /** Positive / available money */
  moneyPositive: string;
  moneyPositiveBg: string;
  /** Negative / overdrawn */
  moneyNegative: string;
  moneyNegativeBg: string;
  warning: string;
  warningBg: string;
  critical: string;
  criticalBg: string;
  neutral: string;
  neutralBg: string;
  skeleton: string;
  overlay: string;
};

export const palettes: Record<ThemeMode, Palette> = {
  light: {
    background: "#F4F6F8",
    surface: "#FFFFFF",
    surfaceMuted: "#EEF1F4",
    border: "#D8DEE6",
    text: "#0F172A",
    textSecondary: "#475569",
    textMuted: "#64748B",
    tint: "#1D4ED8",
    tintMuted: "#DBEAFE",
    onTint: "#FFFFFF",
    moneyPositive: "#047857",
    moneyPositiveBg: "#D1FAE5",
    moneyNegative: "#B91C1C",
    moneyNegativeBg: "#FEE2E2",
    warning: "#B45309",
    warningBg: "#FEF3C7",
    critical: "#991B1B",
    criticalBg: "#FECACA",
    neutral: "#334155",
    neutralBg: "#E2E8F0",
    skeleton: "#E2E8F0",
    overlay: "rgba(15, 23, 42, 0.45)",
  },
  dark: {
    background: "#0B1220",
    surface: "#152033",
    surfaceMuted: "#1C2A40",
    border: "#2A3A52",
    text: "#F1F5F9",
    textSecondary: "#CBD5E1",
    textMuted: "#94A3B8",
    tint: "#60A5FA",
    tintMuted: "#1E3A5F",
    onTint: "#0B1220",
    moneyPositive: "#34D399",
    moneyPositiveBg: "#064E3B",
    moneyNegative: "#F87171",
    moneyNegativeBg: "#7F1D1D",
    warning: "#FBBF24",
    warningBg: "#78350F",
    critical: "#FCA5A5",
    criticalBg: "#7F1D1D",
    neutral: "#CBD5E1",
    neutralBg: "#1E293B",
    skeleton: "#1E293B",
    overlay: "rgba(0, 0, 0, 0.55)",
  },
};

export type AppTheme = {
  mode: ThemeMode;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  touchTarget: typeof touchTarget;
};

export function createTheme(mode: ThemeMode): AppTheme {
  return {
    mode,
    colors: palettes[mode],
    spacing,
    radius,
    typography,
    touchTarget,
  };
}

export type FinancialTone = "positive" | "negative" | "warning" | "critical" | "neutral";

export function financialToneColors(theme: AppTheme, tone: FinancialTone) {
  switch (tone) {
    case "positive":
      return { fg: theme.colors.moneyPositive, bg: theme.colors.moneyPositiveBg, label: "Positive" };
    case "negative":
      return { fg: theme.colors.moneyNegative, bg: theme.colors.moneyNegativeBg, label: "Negative" };
    case "warning":
      return { fg: theme.colors.warning, bg: theme.colors.warningBg, label: "Warning" };
    case "critical":
      return { fg: theme.colors.critical, bg: theme.colors.criticalBg, label: "Critical" };
    default:
      return { fg: theme.colors.neutral, bg: theme.colors.neutralBg, label: "Info" };
  }
}
