import presetWind3 from "@unocss/preset-wind3";
import { defineConfig } from "unocss";

/**
 * Semantic utility colors map one-to-one onto the token layer in
 * src/styles/tokens.css (XBond Instrument Deck). Raw palette classes
 * (bg-emerald-*, text-sky-500, …) are banned — status and surfaces always
 * go through these tokens so light/dark stay isomorphic.
 */
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    fontFamily: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    colors: {
      background: "var(--background)",
      foreground: "var(--foreground)",
      card: "var(--card)",
      "card-foreground": "var(--card-foreground)",
      popover: "var(--popover)",
      "popover-foreground": "var(--popover-foreground)",
      inset: "var(--surface-inset)",
      primary: "var(--primary)",
      "primary-foreground": "var(--primary-foreground)",
      secondary: "var(--secondary)",
      "secondary-foreground": "var(--secondary-foreground)",
      muted: "var(--muted)",
      "muted-foreground": "var(--muted-foreground)",
      accent: "var(--accent)",
      "accent-foreground": "var(--accent-foreground)",
      destructive: "var(--destructive)",
      "destructive-foreground": "var(--destructive-foreground)",
      brand: "var(--brand)",
      "brand-foreground": "var(--brand-foreground)",
      "brand-text": "var(--brand-text)",
      success: "var(--success)",
      "success-foreground": "var(--success-foreground)",
      warning: "var(--warning)",
      "warning-foreground": "var(--warning-foreground)",
      info: "var(--info)",
      "info-foreground": "var(--info-foreground)",
      border: "var(--border)",
      "border-strong": "var(--border-strong)",
      sidebar: "var(--sidebar)",
      "sidebar-foreground": "var(--sidebar-foreground)",
      "sidebar-foreground-muted": "var(--sidebar-foreground-muted)",
      "sidebar-accent": "var(--sidebar-accent)",
      "sidebar-accent-foreground": "var(--sidebar-accent-foreground)",
      "strategy-surface": "var(--strategy-surface)",
      "strategy-surface-foreground": "var(--strategy-surface-foreground)",
      "strategy-surface-muted": "var(--strategy-surface-muted)",
      "strategy-surface-border": "var(--strategy-surface-border)",
      "strategy-surface-inset": "var(--strategy-surface-inset)",
    },
  },
});
