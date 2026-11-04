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
  return (
    <div className={cn("relative size-16 shrink-0", className)}>
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="block size-full -rotate-90"
      >
        <circle
          className="stroke-inset"
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="8"
        />
        <circle
          className="stroke-brand"
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="8"
          pathLength="100"
          strokeDasharray={`${clamped} 100`}
          strokeLinecap={clamped > 0 ? "round" : "butt"}
        />
      </svg>
      <span className="quota-ring-label">{Math.round(clamped)}%</span>
    </div>
  );
}
