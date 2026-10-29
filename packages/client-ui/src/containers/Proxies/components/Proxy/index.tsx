import { renderNodeTitle } from "@components";
import { type BaseComponentProps } from "@models";
import { useLatency } from "@stores/latency";
import { type Proxy as IProxy } from "@xbond/client/request";
import classnames from "classnames";
import { useTranslation } from "react-i18next";

import "./style.scss";

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

  return (
    <div
      className={classnames(
        "proxy-card-item",
        {
          "is-failed": isFailed,
          "is-error": isFailed,
          "is-untested": isUntested,
        },
        className,
      )}
    >
      <div className="proxy-card-top">
        <div className="proxy-card-badges">
          <span className="proxy-protocol-tag">{config.type}</span>
          {config.udp && <span className="proxy-udp-pill">UDP</span>}
        </div>

        <div className="proxy-card-latency-row">
          <span
            className={classnames("proxy-delay-badge", {
              "is-fast": !isTesting && !isFailed && delay > 0 && delay < 150,
              "is-medium":
                !isTesting && !isFailed && delay >= 150 && delay <= 400,
              "is-slow": !isTesting && !isFailed && delay > 400,
              "is-testing": isTesting,
              "is-failed": isFailed,
              "is-untested": !isTesting && !isFailed && delay === 0,
            })}
          >
            {delay > 0 && !isTesting && !isFailed && (
              <span className="latency-dot" aria-hidden="true" />
            )}
            {delayText}
            {meanDelayText}
          </span>

          {!isBuiltin && (
            <button
              type="button"
              className={classnames("proxy-single-ping-btn", {
                "is-testing": isTesting,
              })}
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

      <div className="proxy-card-bottom">
        <p className="proxy-card-name" title={config.name}>
          {renderNodeTitle(config.name)}
        </p>
      </div>
    </div>
  );
}
