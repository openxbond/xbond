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
      <div className="h-full flex flex-col items-center justify-center text-xs md:h-[18px] md:flex-row md:justify-between space-y-3 md:space-y-0">
        <button
          className="tabular-nums cursor-pointer disabled:cursor-wait"
          disabled={progress.running}
          onClick={() => {
            void run([config.name]);
          }}
          aria-label={`${t("start")}: ${config.name}`}
        >
          {delayText}
          {meanDelayText}
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
