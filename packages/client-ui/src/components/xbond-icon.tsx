import type { SVGProps } from "react";

interface XBondIconProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

/** Canonical brand geometry (shared by the logo and branded Cloud mark). */
export const XBOND_CHEVRON_PATH = "M14 14H35.5L58 50L35.5 86H14L36.5 50L14 14Z";
export const XBOND_WINGS_PATH =
  "M64.5 14H86L65.25 47.2L54.5 30Z M54.5 70L65.25 52.8L86 86H64.5Z";

/**
 * XBond Brand Glyph.
 *
 * Orange forward chevron (#F38020) plus two adaptive wings (currentColor) that
 * float a constant channel away from it. Geometry is canonical in the xbond
 * repo (scripts/build-logo-assets.ts) — keep the paths in sync.
 */
export function XBondIcon({
  className = "sidebar-logo-mark",
  ...props
}: XBondIconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Cloudflare Orange forward-accelerator chevron */}
      <path d={XBOND_CHEVRON_PATH} fill="#F38020" />
      {/* Adaptive wings: ink in light mode, white in dark mode */}
      <path d={XBOND_WINGS_PATH} fill="currentColor" />
    </svg>
  );
}
