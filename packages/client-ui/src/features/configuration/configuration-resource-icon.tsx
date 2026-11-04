import { FileText, Monitor, SlidersHorizontal } from "lucide-react";
import { useId } from "react";

import clashLogo from "@/assets/core-icons/mihomo.png";
import singBoxLogo from "@/assets/core-icons/sing-box.svg";
import { XBOND_CHEVRON_PATH } from "@/components/xbond-icon";

// Smooth cumulus silhouette, used as a single-colour mark.
const CLOUD_PATH =
  "M251-160q-88 0-149.5-61.5T40-371q0-78 50-137t127-71q20-97 94-158.5T482-799q112 0 189 81.5T748-522v24q72-2 122 46.5T920-329q0 69-50 119t-119 50H251Z";
const CLOUD_TRANSFORM = "translate(3.2 21.28) scale(0.018)";

/**
 * XBond Cloud mark: one dense brand-orange cloud with the forward chevron
 * softened into the surface. The cut is deliberately partial-transparency so
 * the brand reads as a tonal mark, not a punched-out logo.
 */
export function CloudMark({ className }: { className?: string }) {
  const id = `xbond-cloud-${useId().replace(/:/g, "")}`;
  const cut = `${id}-cut`;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" width="24" height="24">
          <g transform="translate(11.9 11.2) scale(1.2) translate(-11.9 -11.2)">
            <path d={CLOUD_PATH} transform={CLOUD_TRANSFORM} fill="white" />
            <path
              d={XBOND_CHEVRON_PATH}
              transform="translate(9 7.4) scale(0.11)"
              fill="#b3b3b3"
              stroke="#b3b3b3"
              strokeWidth="4"
              strokeLinejoin="round"
            />
          </g>
        </mask>
      </defs>
      <rect width="24" height="24" fill="#F38020" mask={`url(#${cut})`} />
    </svg>
  );
}

export function ResourceIcon({
  kind,
  className = "size-9",
}: {
  kind: "cloud" | "controller" | "clash" | "sing-box" | "local" | "mixin";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-control p-1.5 text-muted-foreground ${
        kind === "cloud" || kind === "mixin" ? "bg-brand-soft" : "bg-inset"
      } ${className}`}
    >
      {kind === "clash" || kind === "sing-box" ? (
        <img
          className="size-full object-contain"
          src={kind === "clash" ? clashLogo : singBoxLogo}
          alt={kind === "clash" ? "Clash / mihomo" : "sing-box"}
        />
      ) : kind === "cloud" ? (
        <CloudMark className="size-full" />
      ) : kind === "controller" ? (
        <Monitor aria-hidden="true" className="size-full" strokeWidth={1.6} />
      ) : kind === "mixin" ? (
        <SlidersHorizontal
          aria-hidden="true"
          className="size-full"
          strokeWidth={1.6}
        />
      ) : (
        <FileText aria-hidden="true" className="size-full" strokeWidth={1.6} />
      )}
    </span>
  );
}
