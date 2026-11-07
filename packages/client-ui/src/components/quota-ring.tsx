import { useId } from "react";

import { cn } from "@/lib/utils";

interface QuotaRingProps {
  /**
   * Remaining quota as 0–100. Values beyond the range clamp to the edge;
   * pair the ring with the literal numbers so over-quota stays readable.
   */
  percent: number;
  className?: string;
}

export function QuotaRing({ percent, className }: QuotaRingProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const gradId = `quota-ring-grad-${useId().replace(/:/g, "")}`;
  return (
    <div
      className={cn(
        "relative grid size-20 shrink-0 place-items-center",
        className,
      )}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="col-start-1 row-start-1 block size-full -rotate-90"
      >
        <defs>
          <linearGradient
            id={gradId}
            x1="0"
            y1="0"
            x2="100"
            y2="100"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-strong)" />
          </linearGradient>
        </defs>
        <circle
          className="stroke-muted"
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="9.5"
        />
        <circle
          stroke={`url(#${gradId})`}
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="9.5"
          pathLength="100"
          strokeDasharray={`${clamped} 100`}
          strokeLinecap={clamped > 0 && clamped < 100 ? "round" : "butt"}
        />
      </svg>
      <span className="col-start-1 row-start-1 text-lg font-bold tracking-tight tabular-nums text-foreground">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
