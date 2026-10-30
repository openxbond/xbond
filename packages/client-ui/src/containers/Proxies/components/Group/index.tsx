import { renderNodeTitle } from "@components";
import { useNodeSelection } from "@lib/node-selection";
import { useProxyMapping } from "@stores";
import { useLatency } from "@stores/latency";
import type { Group as IGroup } from "@xbond/client/request";
import { strategyPath } from "@xbond/client/workspace";
import { useEffect, useRef, useState } from "react";
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "latency" | "name">(
    "default",
  );
  const gridRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [filterOpen]);

  const path = strategyPath(config, mapping);
  const delayFor = (name: string) => {
    const result = results[name];
    return result?.delay ?? mapping.get(name)?.history?.at(-1)?.delay;
  };
  const names = (() => {
    const visible = config.all.filter(
      (name) =>
        (!search ||
          config.name.toLowerCase().includes(search.toLowerCase()) ||
          name.toLowerCase().includes(search.toLowerCase())) &&
        (!filter || name.toLowerCase().includes(filter.toLowerCase())),
    );
    if (sortMode === "name")
      return [...visible].sort((a, b) => a.localeCompare(b));
    if (sortMode === "latency") {
      const latencyKey = (name: string) => {
        const delay = delayFor(name);
        return delay !== undefined && delay > 0
          ? delay
          : Number.POSITIVE_INFINITY;
      };
      return [...visible].sort((a, b) => {
        const left = latencyKey(a);
        const right = latencyKey(b);
        return left === right ? a.localeCompare(b) : left - right;
      });
    }
    return visible;
  })();

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

  const sortLabel =
    sortMode === "latency"
      ? t("sortLatency")
      : sortMode === "name"
        ? t("sortName")
        : t("sortDefault");

  function cycleSort() {
    setSortMode((mode) =>
      mode === "default" ? "latency" : mode === "latency" ? "name" : "default",
    );
  }

  function toggleFilter() {
    setFilterOpen((open) => {
      if (open) setFilter("");
      return !open;
    });
  }

  function runGroupTests() {
    void run(
      names.filter((name) => {
        const item = mapping.get(name);
        return item && !["Direct", "Reject", "DNS"].includes(item.type);
      }),
    );
  }

  function locateSelected() {
    if (!config.now) return;
    const tile = gridRef.current?.querySelector<HTMLElement>(
      `[data-node="${CSS.escape(config.now)}"]`,
    );
    if (!tile) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    tile.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    tile.classList.add("is-located");
    window.setTimeout(() => tile.classList.remove("is-located"), 1400);
  }

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
          <div className={`group-filter-box ${filterOpen ? "is-open" : ""}`}>
            <input
              ref={filterRef}
              type="text"
              className="group-filter-input"
              placeholder={t("filterNodes")}
              aria-label={t("filterNodes")}
              value={filter}
              tabIndex={filterOpen ? 0 : -1}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFilter("");
                  setFilterOpen(false);
                }
              }}
            />
          </div>

          <div className="group-icon-actions">
            <button
              type="button"
              className="group-icon-btn"
              title={t("locate")}
              aria-label={t("locate")}
              disabled={!config.now}
              onClick={locateSelected}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="6.5" />
                <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
                <circle
                  cx="12"
                  cy="12"
                  r="1.6"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </button>

            <button
              type="button"
              className="group-icon-btn"
              title={t("groupTest")}
              aria-label={t("groupTest")}
              disabled={progress.running || !names.length}
              onClick={runGroupTests}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </button>

            <button
              type="button"
              className={`group-icon-btn ${sortMode !== "default" ? "is-active" : ""}`}
              title={t("sortState", { mode: sortLabel })}
              aria-label={t("sortState", { mode: sortLabel })}
              onClick={cycleSort}
            >
              {sortMode === "default" ? (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 6h16M4 12h10M4 18h6" />
                </svg>
              ) : sortMode === "latency" ? (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="13.5" r="6.5" />
                  <path d="M12 10.5v3l2 2" />
                  <path d="M9.5 2.5h5" />
                </svg>
              ) : (
                <span className="sort-az" aria-hidden="true">
                  AZ
                </span>
              )}
            </button>

            <button
              type="button"
              className={`group-icon-btn ${filterOpen || filter ? "is-active" : ""}`}
              title={t("filterNodes")}
              aria-label={t("filterNodes")}
              onClick={toggleFilter}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m20 20-3.6-3.6" />
              </svg>
            </button>
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
      <ul className="group-nodes-grid" ref={gridRef}>
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
              data-node={name}
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
