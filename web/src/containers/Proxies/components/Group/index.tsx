import { Button, renderNodeTitle } from "@components";
import { CopyButton } from "@components/CopyButton";
import { useNodeSelection } from "@lib/node-selection";
import type { Group as IGroup } from "@lib/request";
import { strategyPath } from "@lib/workspace";
import { useProxyMapping } from "@stores";
import { useLatency } from "@stores/latency";
import { useTranslation } from "react-i18next";

import "./style.scss";

export function Group({
  config,
  search = "",
}: {
  config: IGroup;
  search?: string;
  initialOpen?: boolean;
}) {
  const mapping = useProxyMapping();
  const {
    select: selectNode,
    pending,
    selectedName: switchingName,
    result: selectionStatus,
  } = useNodeSelection();
  const { run, results, progress } = useLatency();
  const { t } = useTranslation("proxies");
  const { t: c } = useTranslation("connect");

  const path = strategyPath(config, mapping);
  const names = config.all.filter(
    (name) =>
      !search ||
      config.name.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase()),
  );

  const delays = new Map(
    names.map((name) => {
      const item = mapping.get(name);
      const result = results[name];
      return [name, result?.delay ?? item?.history?.at(-1)?.delay];
    }),
  );
  const statuses = new Map(
    names.map((name) => [name, results[name]?.status || ""]),
  );
  const canTests = new Map(
    names.map((name) => {
      const item = mapping.get(name);
      return [
        name,
        Boolean(item && !["Direct", "Reject", "DNS"].includes(item.type)),
      ];
    }),
  );

  const select = (name: string) => selectNode(config.name, name);

  return (
    <div className="group-workbench-panel">
      {/* Group Header Banner */}
      <div className="group-panel-header">
        <div className="group-info-col">
          <div className="group-heading-row">
            <h3 className="group-title">{config.name}</h3>
            <span className="group-type-pill">{config.type}</span>
            <span className="group-count-pill">
              {t("groupMembers", { count: config.all.length })}
            </span>
          </div>
          <div className="group-chain-row" title={path.join(" → ")}>
            <span>
              {path.map((segment, idx) => (
                <span key={idx}>
                  {idx > 0 && " → "}
                  {renderNodeTitle(segment)}
                </span>
              ))}
            </span>
          </div>
        </div>

        <div className="group-actions-col">
          <div className="group-selected-status">
            <span className="status-label">{t("selected")}</span>
            <strong className="status-val">
              {config.now ? renderNodeTitle(config.now) : "—"}
            </strong>
          </div>
          <div className="group-btn-group">
            {config.now && (
              <CopyButton value={config.now} label={c("copyNode")} />
            )}
            <Button
              disabled={progress.running || !names.length}
              onClick={() =>
                void run(
                  names.filter((name) => {
                    const item = mapping.get(name);
                    return (
                      item && !["Direct", "Reject", "DNS"].includes(item.type)
                    );
                  }),
                )
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                {t("groupTest")}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {(pending || selectionStatus !== "idle") && (
        <p
          className={
            "group-feedback " +
            (selectionStatus === "failed"
              ? "is-error"
              : selectionStatus === "partial"
                ? "is-warning"
                : "")
          }
          role={selectionStatus === "failed" ? "alert" : "status"}
        >
          {t(
            pending
              ? "switching"
              : selectionStatus === "partial"
                ? "switchPartial"
                : selectionStatus === "success"
                  ? "switched"
                  : "switchFailed",
          )}
        </p>
      )}

      {/* Multi-column Compact Grid of Node Tiles */}
      <ul className="group-nodes-grid">
        {names.map((name) => {
          const isSelected = config.now === name;
          const delay = delays.get(name);
          const status = statuses.get(name);
          const isTesting = status === "testing";
          const item = mapping.get(name);
          const isBuiltin =
            ["Direct", "Reject", "DNS", "Compatible"].includes(
              item?.type ?? "",
            ) ||
            ["DIRECT", "REJECT", "GLOBAL", "COMPATIBLE"].includes(
              name.toUpperCase(),
            );
          const canTest = !isBuiltin && (canTests.get(name) ?? false);
          const canClick = config.type === "Selector";

          const hasHistory = Boolean(item?.history?.length);
          const isDead = item?.alive === false;
          const isFailed =
            !isBuiltin &&
            (isDead ||
              (Boolean(status) && status !== "ok" && status !== "testing") ||
              (delay === 0 && hasHistory));

          let delayTone = "untested";
          let delayDisplay: string = t("untested");
          if (isBuiltin) {
            delayTone = "builtin";
            delayDisplay = t("builtin");
          } else if (isTesting) {
            delayTone = "testing";
            delayDisplay = t("testing");
          } else if (isFailed) {
            delayTone = "failed";
            delayDisplay = status === "timedOut" ? t("timedOut") : t("failed");
          } else if (delay !== undefined && delay > 0) {
            if (delay < 150) delayTone = "good";
            else if (delay <= 400) delayTone = "medium";
            else delayTone = "slow";
            delayDisplay = `${delay} ms`;
          }

          return (
            <li
              key={name}
              className={`node-grid-tile ${isSelected ? "is-selected" : ""} ${
                canClick ? "is-clickable" : "is-readonly"
              } ${isFailed ? "is-failed" : ""}`}
              onClick={() => {
                if (canClick && !pending) {
                  void select(name);
                }
              }}
            >
              <div className="tile-left">
                <span
                  className={`tile-radio ${isSelected ? "is-active" : ""}`}
                  aria-hidden="true"
                >
                  {isSelected ? (
                    <svg
                      viewBox="0 0 16 16"
                      width="13"
                      height="13"
                      fill="currentColor"
                    >
                      <circle cx="8" cy="8" r="7" />
                      <path
                        d="m4.8 8 2.2 2.2 4.2-4.2"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 16 16"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <circle cx="8" cy="8" r="6.5" />
                    </svg>
                  )}
                </span>
                <span className="tile-name" title={name}>
                  {pending && switchingName === name
                    ? t("switching")
                    : renderNodeTitle(name)}
                </span>
              </div>

              <div className="tile-right">
                <span className={`node-delay-pill ${delayTone}`}>
                  {delayDisplay}
                </span>

                {canTest && (
                  <button
                    type="button"
                    className={`node-speed-btn ${isTesting ? "is-testing" : ""}`}
                    title={t("testNode")}
                    aria-label={t("testNodeAria", { name })}
                    disabled={isTesting}
                    onClick={(e) => {
                      e.stopPropagation();
                      void run([name]);
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
