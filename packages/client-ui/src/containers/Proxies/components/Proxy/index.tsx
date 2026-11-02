import { renderNodeTitle } from "@components";
import { type BaseComponentProps } from "@models";
import { useLatency } from "@stores/latency";
import { type Proxy as IProxy } from "@xbond/client/request";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

type BadgeTone = "fast" | "medium" | "slow" | "failed" | "testing" | "untested";

/* Latency badge palettes, keyed by the tone computed below. Hard-coded oklch
   values are the original SCSS traffic-light washes; the dot gets a stronger
   step of the same hue so it stays legible on the wash. */
const BADGE_TONES: Record<BadgeTone, string> = {
  fast: "bg-[oklch(0.92_0.08_145)] text-[oklch(0.38_0.14_145)]",
  medium: "bg-[oklch(0.94_0.1_85)] text-[oklch(0.48_0.14_85)]",
  slow: "bg-[oklch(0.92_0.09_45)] text-[oklch(0.48_0.15_45)]",
  failed: "bg-[oklch(0.92_0.08_25)] text-destructive",
  testing: "animate-pulse bg-brand-soft text-brand-text",
  untested: "text-muted-foreground",
};

const BADGE_DOTS: Record<BadgeTone, string> = {
  fast: "bg-[oklch(0.48_0.16_145)]",
  medium: "bg-[oklch(0.58_0.16_85)]",
  slow: "bg-[oklch(0.58_0.17_45)]",
  failed: "bg-current",
  testing: "bg-current",
  untested: "bg-current",
};

interface ProxyProps extends BaseComponentProps {
  config: IProxy;
}

export function Proxy(props: ProxyProps) {
  const { config, className } = props;
  const { results, progress, run } = useLatency();
  const { t } = useTranslation("proxies");
  const result = results[config.name];

  const delay = result
    ? (result.delay ?? 0)
    : config.history?.length
      ? config.history.slice(-1)[0].delay
      : 0;
  const meanDelay =
    !result && config.history?.length
      ? config.history.slice(-1)[0].meanDelay
      : undefined;

  const isBuiltin =
    ["Direct", "Reject", "DNS", "Compatible"].includes(config.type) ||
    ["DIRECT", "REJECT", "GLOBAL", "COMPATIBLE"].includes(
      config.name.toUpperCase(),
    );
  const hasHistory = Boolean(config.history?.length);
  const isTesting = result?.status === "testing";
  const isFailed =
    !isBuiltin &&
    (config.alive === false ||
      (result && result.status !== "ok" && result.status !== "testing") ||
      (delay === 0 && hasHistory));
  // Never measured and no history from the core: no connection data yet, so
  // the card renders muted instead of competing with measured nodes.
  const isUntested =
    !isBuiltin && !isTesting && !isFailed && delay === 0 && !hasHistory;

  const delayText = isBuiltin
    ? t("builtin")
    : isTesting
      ? t("testing")
      : result && result.status !== "ok"
        ? t(result.status)
        : delay > 0
          ? `${delay} ms`
          : hasHistory
            ? t("failed")
            : "—";
  const meanDelayText = !meanDelay || isTesting ? "" : ` (${meanDelay}ms)`;

  const badgeTone: BadgeTone = isTesting
    ? "testing"
    : isFailed
      ? "failed"
      : delay > 0
        ? delay < 150
          ? "fast"
          : delay <= 400
            ? "medium"
            : "slow"
        : "untested";

  return (
    <div
      className={cn(
        "relative flex min-h-[88px] flex-col justify-between rounded-card border border-border bg-card px-[18px] py-4 shadow-elevation-card transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:border-brand hover:shadow-[0_4px_14px_oklch(0_0_0/5%)]",
        isFailed &&
          "border-destructive bg-inset opacity-52 shadow-none hover:-translate-y-px hover:border-border-strong hover:opacity-85 hover:shadow-none",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-[5px] border border-border bg-inset px-[7px] py-[2.5px] text-[11px] font-bold uppercase leading-[1.2] tracking-[0.04em] text-muted-foreground",
              isFailed && "bg-transparent opacity-65",
              isUntested && "bg-transparent",
            )}
          >
            {config.type}
          </span>
          {config.udp && (
            <span
              className={cn(
                "inline-flex items-center rounded-[4px] border border-border bg-inset px-1.5 py-0.5 text-[10px] font-bold leading-[1.2] tracking-[0.02em] text-muted-foreground",
                isFailed && "bg-transparent opacity-65",
                isUntested && "bg-transparent",
              )}
            >
              UDP
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] bg-inset px-2 py-[3px] text-xs font-semibold leading-[1.2] tabular-nums transition-colors duration-200",
              BADGE_TONES[badgeTone],
            )}
          >
            {delay > 0 && !isTesting && !isFailed && (
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full bg-current",
                  BADGE_DOTS[badgeTone],
                )}
                aria-hidden="true"
              />
            )}
            {delayText}
            {meanDelayText}
          </span>

          {!isBuiltin && (
            <button
              type="button"
              className={cn(
                "inline-flex size-7 cursor-pointer items-center justify-center rounded-[7px] border border-border bg-inset p-0 text-muted-foreground transition-all duration-150 hover:scale-[1.06] hover:border-brand hover:bg-brand-soft hover:text-brand-text",
                (isFailed || isUntested) && "opacity-75",
                isTesting && "animate-pulse text-brand-text opacity-80",
              )}
              disabled={progress.running || isTesting}
              onClick={() => {
                void run([config.name]);
              }}
              title={t("testNode")}
              aria-label={t("testNodeAria", { name: config.name })}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill={isTesting ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 min-w-0">
        <p
          className={cn(
            "m-0 truncate text-[14.5px] font-semibold leading-[1.35] tracking-[-0.01em] text-foreground",
            (isFailed || isUntested) && "text-muted-foreground",
          )}
          title={config.name}
        >
          {renderNodeTitle(config.name)}
        </p>
      </div>
    </div>
  );
}
