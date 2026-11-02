import { formatRate } from "@xbond/client/activity";

export interface TrafficSample {
  up: number;
  down: number;
  at: number;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;

/** 圖例列：圓點 + 標籤，資料態再加即時峰值。 */
function Legend({
  downloadLabel,
  uploadLabel,
  peak,
}: {
  downloadLabel: string;
  uploadLabel: string;
  peak?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-[5px]">
        <span className="size-[7px] rounded-full bg-brand" /> {downloadLabel}
      </span>
      <span className="inline-flex items-center gap-[5px]">
        <span className="size-[7px] rounded-full bg-muted-foreground" />{" "}
        {uploadLabel}
      </span>
      {peak && (
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {peak}
        </span>
      )}
    </div>
  );
}

/** 即時走勢：真面積圖，僅畫真實樣本；資料不足如實顯示取樣提示。 */
export function TrafficChart({
  samples,
  title,
  empty,
  windowLabel,
  downloadLabel,
  uploadLabel,
}: {
  samples: TrafficSample[];
  title: string;
  empty: string;
  windowLabel: string;
  downloadLabel: string;
  uploadLabel: string;
}) {
  if (samples.length < 2) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 max-md:hidden">
        <Legend downloadLabel={downloadLabel} uploadLabel={uploadLabel} />
        <p className="grid min-h-[120px] flex-1 place-items-center text-[12.5px] text-muted-foreground">
          {empty}
        </p>
        <span
          className="self-end text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          {windowLabel}
        </span>
      </div>
    );
  }

  const maximum = Math.max(
    1,
    ...samples.flatMap((sample) => [sample.up, sample.down]),
  );
  const toPoints = (direction: "up" | "down") =>
    samples.map((sample, index) => [
      (index / (samples.length - 1)) * CHART_WIDTH,
      CHART_HEIGHT - (sample[direction] / maximum) * (CHART_HEIGHT - 10),
    ]) as Array<[number, number]>;
  // Catmull-Rom 轉三次貝塞爾：走勢線平滑貼合真實樣本，不虛構波動。
  const smoothPath = (points: Array<[number, number]>) => {
    let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };
  const downLine = smoothPath(toPoints("down"));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 max-md:hidden">
      <Legend
        downloadLabel={downloadLabel}
        uploadLabel={uploadLabel}
        peak={formatRate(maximum)}
      />
      <div className="relative min-h-[120px] flex-1">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          aria-label={title}
          className="absolute inset-0 size-full"
        >
          <title>{title}</title>
          <defs>
            <linearGradient id="live-download-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path
            d={`M0 ${(CHART_HEIGHT / 2).toFixed(0)}h${CHART_WIDTH}`}
            className="fill-none stroke-border [stroke-dasharray:3_5] [stroke-width:1]"
          />
          <path
            d={`M0 ${(CHART_HEIGHT * 0.25).toFixed(0)}h${CHART_WIDTH}`}
            className="fill-none stroke-border [stroke-dasharray:3_5] [stroke-width:1]"
          />
          <path
            d={`M${(CHART_WIDTH / 3).toFixed(0)} 0v${CHART_HEIGHT}`}
            className="fill-none stroke-border [stroke-dasharray:3_5] [stroke-width:1]"
          />
          <path
            d={`M${((CHART_WIDTH * 2) / 3).toFixed(0)} 0v${CHART_HEIGHT}`}
            className="fill-none stroke-border [stroke-dasharray:3_5] [stroke-width:1]"
          />
          <path
            d={`${downLine} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`}
            fill="url(#live-download-fill)"
            stroke="none"
          />
          <path
            d={downLine}
            className="fill-none stroke-brand [stroke-linejoin:round] [stroke-width:2] [vector-effect:non-scaling-stroke]"
          />
          <path
            d={smoothPath(toPoints("up"))}
            className="fill-none stroke-muted-foreground opacity-70 [stroke-linejoin:round] [stroke-width:1.4] [vector-effect:non-scaling-stroke]"
          />
        </svg>
        <span
          className="self-end text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          {windowLabel}
        </span>
      </div>
    </div>
  );
}
