import { type Proxy as IProxy } from "@xbond/client/request";
import { useTranslation } from "react-i18next";

import { type BaseComponentProps } from "@/components/component-props";
import { renderNodeTitle } from "@/components/country-flag";
import { cn } from "@/lib/utils";

import {
  DELAY_PILL_BASE,
  DELAY_PILL_DOTS,
  DELAY_PILL_TONES,
  hasDelayDot,
  type DelayPillTone,
} from "./delay-pill";
import { useLatency } from "./latency-context";

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

  const badgeTone: DelayPillTone = isTesting
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
        "relative flex min-h-[88px] flex-col justify-between rounded-card border border-border bg-card px-[18px] py-4 transition-[color,background-color,border-color,transform] duration-150 hover:border-brand/60 hover:bg-row-hover",
        // 失敗卡仍須可讀：保留邊框與徽章提示，整體只輕微降低存在感。
        isFailed &&
          "border-destructive bg-inset opacity-80 shadow-none hover:-translate-y-px hover:border-destructive hover:opacity-100 hover:shadow-none",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full bg-inset px-2 py-0.5 text-label font-semibold leading-[1.2] text-muted-foreground",
              isFailed && "bg-transparent opacity-65",
              isUntested && "bg-transparent",
            )}
          >
            {config.type}
          </span>
          {config.udp && (
            <span
              className={cn(
                "inline-flex items-center rounded-full bg-inset px-2 py-0.5 text-label font-medium leading-[1.2] text-muted-foreground",
                isFailed && "bg-transparent opacity-65",
                isUntested && "bg-transparent",
              )}
            >
              UDP
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isBuiltin && (
            <button
              type="button"
              className={cn(
                "inline-flex size-7 max-md:size-10 cursor-pointer items-center justify-center rounded-control border border-border bg-inset p-0 text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 hover:scale-[1.06] hover:border-brand hover:bg-brand-soft hover:text-brand-text",
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

          <span className={cn(DELAY_PILL_BASE, DELAY_PILL_TONES[badgeTone])}>
            {hasDelayDot(badgeTone) && (
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full bg-current",
                  DELAY_PILL_DOTS[badgeTone],
                )}
                aria-hidden="true"
              />
            )}
            {delayText}
            {meanDelayText}
          </span>
        </div>
      </div>

      <div className="mt-3 min-w-0">
        <p
          className={cn(
            "m-0 truncate text-sm leading-[1.35] tracking-[-0.01em] text-foreground",
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
