import { delayToneClass } from "@lib/latency";
import { type Proxy as IProxy } from "@lib/request";
import { type BaseComponentProps } from "@models";
import { useI18n } from "@stores";
import { useLatency } from "@stores/latency";
import classnames from "classnames";

import "./style.scss";

export { delayToneClass };

interface ProxyProps extends BaseComponentProps {
  config: IProxy;
}

export function Proxy(props: ProxyProps) {
  const { config, className } = props;
  const { results, progress, run } = useLatency();
  const { translation } = useI18n();
  const { t } = translation("Speed");
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

  const delayText =
    result && result.status !== "ok"
      ? t(result.status)
      : delay > 0
        ? `${delay}ms`
        : config.history?.length
          ? t("failed")
          : t("untested");
  const meanDelayText = !meanDelay ? "" : `(${meanDelay}ms)`;

  const hasError = delay === 0;
  const toneClass = hasError
    ? "bg-muted text-muted-foreground"
    : delayToneClass(meanDelay ?? delay);

  return (
    <div
      className={classnames(
        "proxy-item",
        { "opacity-60": hasError },
        className,
      )}
    >
      <div className="flex-1">
        <span
          className={classnames(
            "rounded py-[3px] px-1.5 text-xs font-medium",
            toneClass,
          )}
        >
          {config.type}
        </span>
        <p className="proxy-name">{config.name}</p>
      </div>
      <div className="h-full flex items-center gap-2 text-xs">
        <span
          className={classnames(
            "rounded py-[3px] px-1.5 text-xs font-medium tabular-nums",
            toneClass,
          )}
        >
          {delayText}
          {meanDelayText}
        </span>
        <button
          type="button"
          className={classnames("node-speed-btn", {
            "is-testing": result?.status === "testing",
          })}
          disabled={progress.running || result?.status === "testing"}
          onClick={() => {
            void run([config.name]);
          }}
          title="單獨測速此節點"
          aria-label={`${t("start")}: ${config.name}`}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill={result?.status === "testing" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </button>
        {config.udp && (
          <p className="rounded bg-inset px-[3px] py-[2px] text-muted-foreground">
            UDP
          </p>
        )}
      </div>
    </div>
  );
}
