import { formatRate } from "@xbond/client/activity";

import "./chart.scss";

export interface TrafficSample {
  up: number;
  down: number;
  at: number;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;

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
      <div className="live-chart">
        <div className="live-chart-legend">
          <span className="legend-item download">
            <span className="dot" /> {downloadLabel}
          </span>
          <span className="legend-item upload">
            <span className="dot" /> {uploadLabel}
          </span>
        </div>
        <p className="chart-empty">{empty}</p>
        <span className="chart-window" aria-hidden="true">
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
    <div className="live-chart">
      <div className="live-chart-legend">
        <span className="legend-item download">
          <span className="dot" /> {downloadLabel}
        </span>
        <span className="legend-item upload">
          <span className="dot" /> {uploadLabel}
        </span>
        <span className="peak-rate">{formatRate(maximum)}</span>
      </div>
      <div className="live-chart-plot">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          aria-label={title}
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
            className="chart-grid"
          />
          <path
            d={`M0 ${(CHART_HEIGHT * 0.25).toFixed(0)}h${CHART_WIDTH}`}
            className="chart-grid"
          />
          <path
            d={`M${(CHART_WIDTH / 3).toFixed(0)} 0v${CHART_HEIGHT}`}
            className="chart-grid"
          />
          <path
            d={`M${((CHART_WIDTH * 2) / 3).toFixed(0)} 0v${CHART_HEIGHT}`}
            className="chart-grid"
          />
          <path
            d={`${downLine} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`}
            fill="url(#live-download-fill)"
            stroke="none"
          />
          <path d={downLine} className="download-line" />
          <path d={smoothPath(toPoints("up"))} className="upload-line" />
        </svg>
        <span className="chart-window" aria-hidden="true">
          {windowLabel}
        </span>
      </div>
    </div>
  );
}
