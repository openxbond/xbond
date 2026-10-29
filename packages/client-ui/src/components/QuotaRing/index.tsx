import classnames from "classnames";

import "./style.scss";

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
    <div className={classnames("quota-ring", className)}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle
          className="quota-ring-track"
          cx="50"
          cy="50"
          r="40"
          fill="none"
          strokeWidth="8"
        />
        <circle
          className="quota-ring-value"
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
