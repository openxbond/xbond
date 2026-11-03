export interface TrafficSample {
  up: number;
  down: number;
  at: number;
}

const CHART_WIDTH = 500;
const CHART_HEIGHT = 100;
const KB = 1024;
const MB = 1024 * 1024;

/** 根据窗口内最大速率自适应 Y 轴刻度与标尺上限，精准适配 <1MB/s 的常见场景 */
export function getChartScale(maxBytesPerSec: number) {
  // 无流量或极小待机流量时，使用 100 KB/s 作为初始基准标尺，保证网格稳定同时对轻量网络活动灵敏
  if (!Number.isFinite(maxBytesPerSec) || maxBytesPerSec <= 0) {
    return {
      top: "100K",
      mid: "50K",
      bottom: "0",
      maxBound: 100 * KB,
    };
  }

  // < 1 MB/s：细粒度阶梯 (50K, 100K, 200K, 500K, 1M)
  if (maxBytesPerSec < MB) {
    const kb = maxBytesPerSec / KB;
    const kbSteps = [50, 100, 200, 500, 1000];
    const targetKb = kbSteps.find((s) => s >= kb) ?? 1000;
    if (targetKb === 1000) {
      return {
        top: "1M",
        mid: "500K",
        bottom: "0",
        maxBound: MB,
      };
    }
    return {
      top: `${targetKb}K`,
      mid: `${Math.round(targetKb / 2)}K`,
      bottom: "0",
      maxBound: targetKb * KB,
    };
  }

  // 1 MB/s ~ 30 MB/s
  const mib = maxBytesPerSec / MB;
  if (mib <= 30) {
    const mbSteps = [2, 5, 10, 30];
    const targetMb = mbSteps.find((s) => s >= mib) ?? 30;
    if (targetMb >= 10) {
      return {
        top: String(targetMb),
        mid: String(Math.round(targetMb / 2)),
        bottom: "0",
        maxBound: targetMb * MB,
      };
    }
    return {
      top: `${targetMb}M`,
      mid: targetMb === 5 ? "2.5M" : `${Math.round(targetMb / 2)}M`,
      bottom: "0",
      maxBound: targetMb * MB,
    };
  }

  // > 30 MB/s 高速传输
  const fastSteps = [50, 100, 200, 500, 1000];
  const targetFast =
    fastSteps.find((s) => s >= mib) ?? Math.ceil(mib / 100) * 100;
  return {
    top: String(targetFast),
    mid: String(Math.round(targetFast / 2)),
    bottom: "0",
    maxBound: targetFast * MB,
  };
}

/** 实时走势：平滑曲线面积图，左侧 Y 轴刻度，右下角时间窗。 */
export function TrafficChart({
  samples,
  title,
  empty,
  windowLabel,
  _downloadLabel,
  _uploadLabel,
}: {
  samples: TrafficSample[];
  title: string;
  empty: string;
  windowLabel: string;
  downloadLabel?: string;
  uploadLabel?: string;
  _downloadLabel?: string;
  _uploadLabel?: string;
}) {
  const maximum = Math.max(
    0,
    ...samples.flatMap((sample) => [sample.up, sample.down]),
  );
  const scale = getChartScale(maximum);

  const toPoints = (direction: "down" | "up") => {
    if (samples.length === 0) return [];
    if (samples.length === 1) {
      const y =
        CHART_HEIGHT -
        2 -
        (Math.min(samples[0][direction], scale.maxBound) / scale.maxBound) *
          (CHART_HEIGHT - 6);
      return [
        [0, y],
        [CHART_WIDTH, y],
      ] as Array<[number, number]>;
    }
    return samples.map((sample, index) => [
      (index / (samples.length - 1)) * CHART_WIDTH,
      CHART_HEIGHT -
        2 -
        (Math.min(sample[direction], scale.maxBound) / scale.maxBound) *
          (CHART_HEIGHT - 6),
    ]) as Array<[number, number]>;
  };

  // Catmull-Rom 转三次贝塞尔平滑贴合样本点
  const smoothPath = (points: Array<[number, number]>) => {
    if (points.length === 0) return "";
    if (points.length === 1)
      return `M0,${points[0][1].toFixed(2)} L${CHART_WIDTH},${points[0][1].toFixed(2)}`;
    let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = Math.max(
        2,
        Math.min(CHART_HEIGHT - 2, p1[1] + (p2[1] - p0[1]) / 6),
      );
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = Math.max(
        2,
        Math.min(CHART_HEIGHT - 2, p2[1] - (p3[1] - p1[1]) / 6),
      );
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };

  const downPoints = toPoints("down");
  const downLine = smoothPath(downPoints);
  const upPoints = toPoints("up");
  const hasUpTraffic = samples.some((s) => s.up > 0);
  const upLine = hasUpTraffic ? smoothPath(upPoints) : "";

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch max-md:hidden">
      <div className="flex flex-1 items-stretch gap-2.5">
        {/* Y 轴刻度 (自适应如 100K/50K/0, 500K/250K/0, 30/15/0) */}
        <div
          className="flex flex-col justify-between py-0.5 text-right font-mono text-label tabular-nums text-muted-foreground/60 select-none w-8 shrink-0"
          aria-hidden="true"
        >
          <span>{scale.top}</span>
          <span>{scale.mid}</span>
          <span>{scale.bottom}</span>
        </div>

        {/* 图表主区域 */}
        <div className="relative min-h-[72px] flex-1">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            aria-label={title}
            className="absolute inset-0 size-full overflow-visible"
          >
            <title>{title}</title>
            <defs>
              <linearGradient
                id="live-download-fill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
                <stop
                  offset="100%"
                  stopColor="var(--brand)"
                  stopOpacity="0.02"
                />
              </linearGradient>
            </defs>

            {/* 水平虚线网格：顶部, 中间, 底部基线 */}
            <line
              x1="0"
              y1="2"
              x2={CHART_WIDTH}
              y2="2"
              className="stroke-border/70 [stroke-dasharray:3_4] [stroke-width:1]"
            />
            <line
              x1="0"
              y1={CHART_HEIGHT / 2}
              x2={CHART_WIDTH}
              y2={CHART_HEIGHT / 2}
              className="stroke-border/70 [stroke-dasharray:3_4] [stroke-width:1]"
            />
            <line
              x1="0"
              y1={CHART_HEIGHT - 2}
              x2={CHART_WIDTH}
              y2={CHART_HEIGHT - 2}
              className="stroke-border/70 [stroke-dasharray:3_4] [stroke-width:1]"
            />

            {/* 垂直虚线网格：等间距划分 */}
            <line
              x1={CHART_WIDTH * 0.2}
              y1="0"
              x2={CHART_WIDTH * 0.2}
              y2={CHART_HEIGHT}
              className="stroke-border/50 [stroke-dasharray:3_4] [stroke-width:1]"
            />
            <line
              x1={CHART_WIDTH * 0.4}
              y1="0"
              x2={CHART_WIDTH * 0.4}
              y2={CHART_HEIGHT}
              className="stroke-border/50 [stroke-dasharray:3_4] [stroke-width:1]"
            />
            <line
              x1={CHART_WIDTH * 0.6}
              y1="0"
              x2={CHART_WIDTH * 0.6}
              y2={CHART_HEIGHT}
              className="stroke-border/50 [stroke-dasharray:3_4] [stroke-width:1]"
            />
            <line
              x1={CHART_WIDTH * 0.8}
              y1="0"
              x2={CHART_WIDTH * 0.8}
              y2={CHART_HEIGHT}
              className="stroke-border/50 [stroke-dasharray:3_4] [stroke-width:1]"
            />

            {/* 样本面积与平滑曲线 */}
            {downPoints.length >= 2 && (
              <>
                <path
                  d={`${downLine} L${CHART_WIDTH},${CHART_HEIGHT - 2} L0,${CHART_HEIGHT - 2} Z`}
                  fill="url(#live-download-fill)"
                  stroke="none"
                />
                <path
                  d={downLine}
                  className="fill-none stroke-brand [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.2] [vector-effect:non-scaling-stroke]"
                />
                {upLine && (
                  <path
                    d={upLine}
                    className="fill-none stroke-muted-foreground/50 [stroke-linecap:round] [stroke-linejoin:round] [stroke-dasharray:3_3] [stroke-width:1.4] [vector-effect:non-scaling-stroke]"
                  />
                )}
              </>
            )}
          </svg>

          {samples.length < 2 && (
            <div className="absolute inset-0 flex items-center justify-center text-label text-muted-foreground/60 select-none">
              {empty}
            </div>
          )}
        </div>
      </div>

      {/* 右下角时间窗标签 */}
      <span
        className="mt-1 self-end text-label text-muted-foreground/60 select-none"
        aria-hidden="true"
      >
        {windowLabel}
      </span>
    </div>
  );
}
