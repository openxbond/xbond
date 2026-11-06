import type { Group as IGroup } from "@xbond/client/request";
import { strategyPath } from "@xbond/client/workspace";
import { Pin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { StrategyChoice, StrategyPath } from "@/components/proxy-strategy";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePinnedNodes } from "@/state/user-preferences";

import { useLatency } from "./latency-context";
import { useProxyMapping } from "./proxy-data";
import { useNodeSelection } from "./use-node-selection";

type DelayTone =
  | "builtin"
  | "testing"
  | "failed"
  | "good"
  | "medium"
  | "slow"
  | "untested";

/* Delay pill palettes, keyed by the tone computed per node below. Hard-coded
   oklch values are the original SCSS traffic-light washes. */
const DELAY_PILL_TONES: Record<DelayTone, string> = {
  builtin:
    "border border-border bg-inset px-[7px] font-medium text-muted-foreground",
  testing: "animate-pulse bg-brand-soft text-brand-text",
  failed: "bg-latency-failed text-latency-failed-text",
  good: "bg-latency-good text-latency-good-text",
  medium: "bg-latency-medium text-latency-medium-text",
  slow: "bg-latency-slow text-latency-slow-text",
  untested: "bg-transparent text-muted-foreground",
};

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
    result: selectionStatus,
  } = useNodeSelection();
  const { run, results, progress } = useLatency();
  const { t } = useTranslation("proxies");
  const { isPinned, togglePin } = usePinnedNodes();
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

    const pinnedList: string[] = [];
    const normalList: string[] = [];
    for (const name of visible) {
      if (isPinned(name)) {
        pinnedList.push(name);
      } else {
        normalList.push(name);
      }
    }

    const sortFn = (a: string, b: string) => {
      if (sortMode === "name") return a.localeCompare(b);
      if (sortMode === "latency") {
        const latencyKey = (name: string) => {
          const delay = delayFor(name);
          return delay !== undefined && delay > 0
            ? delay
            : Number.POSITIVE_INFINITY;
        };
        const left = latencyKey(a);
        const right = latencyKey(b);
        return left === right ? a.localeCompare(b) : left - right;
      }
      return 0;
    };

    if (sortMode !== "default") {
      pinnedList.sort(sortFn);
      normalList.sort(sortFn);
    }

    return [...pinnedList, ...normalList];
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
    <div className="flex h-full flex-col gap-4 p-5 max-md:p-3">
      {/* Group Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4 max-md:flex-col max-md:items-stretch max-md:gap-3 max-md:px-4 max-md:py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5 max-md:flex-wrap max-md:gap-2">
            <h3 className="m-0 text-base font-semibold text-foreground">
              {config.name}
            </h3>
            <Badge variant="secondary">{config.type}</Badge>
            <span className="text-label text-muted-foreground">
              {t("groupMembers", { count: config.all.length })}
            </span>
          </div>
          <div className="max-w-[500px] truncate text-xs text-muted-foreground max-md:text-label max-md:leading-[1.4]">
            <StrategyPath path={path} />
          </div>
        </div>

        <div className="flex items-center gap-2.5 max-md:justify-between">
          <div
            className={cn(
              "overflow-hidden opacity-0 max-w-0 transition-all duration-200 ease-[var(--ease-out-expo)]",
              filterOpen && "max-w-[180px] opacity-100 max-md:max-w-[140px]",
            )}
          >
            <input
              ref={filterRef}
              type="text"
              className="h-[30px] w-[180px] rounded-sm border border-border bg-inset px-2.5 text-label text-foreground outline-none placeholder:text-muted-foreground focus:border-brand max-md:min-h-10 max-md:w-[140px]"
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

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex size-[30px] max-md:size-11 cursor-pointer items-center justify-center rounded-sm border border-border bg-inset p-0 text-muted-foreground transition-colors duration-150 enabled:hover:border-brand enabled:hover:bg-brand-soft enabled:hover:text-brand-text"
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
              className="inline-flex size-[30px] max-md:size-11 cursor-pointer items-center justify-center rounded-sm border border-border bg-inset p-0 text-muted-foreground transition-colors duration-150 enabled:hover:border-brand enabled:hover:bg-brand-soft enabled:hover:text-brand-text"
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
              className={cn(
                "inline-flex size-[30px] max-md:size-11 cursor-pointer items-center justify-center rounded-sm border border-border bg-inset p-0 text-muted-foreground transition-colors duration-150 enabled:hover:border-brand enabled:hover:bg-brand-soft enabled:hover:text-brand-text",
                sortMode !== "default" &&
                  "border-brand bg-brand-soft text-brand-text",
              )}
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
                <span
                  className="text-label font-bold tracking-[0.02em]"
                  aria-hidden="true"
                >
                  AZ
                </span>
              )}
            </button>

            <button
              type="button"
              className={cn(
                "inline-flex size-[30px] max-md:size-11 cursor-pointer items-center justify-center rounded-sm border border-border bg-inset p-0 text-muted-foreground transition-colors duration-150 enabled:hover:border-brand enabled:hover:bg-brand-soft enabled:hover:text-brand-text",
                (filterOpen || filter) &&
                  "border-brand bg-brand-soft text-brand-text",
              )}
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
          className={cn(
            "m-0 rounded-control bg-inset px-3 py-2 text-label text-success-text",
            selectionStatus === "failed" &&
              "bg-latency-failed text-destructive-text",
            selectionStatus === "partial" && "text-warning-text",
          )}
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

      {/* Multi-column High-Density Matrix of Node Tiles — desktop scrolls
          inside this grid so the group tools stay pinned above it. */}
      <ul
        className="m-0 grid list-none content-start gap-2 overflow-y-auto p-0 pr-1 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] max-md:grid-cols-1 max-md:overflow-visible md:min-h-0 md:flex-1"
        ref={gridRef}
      >
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

          let delayTone: DelayTone = "untested";
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
            <StrategyChoice
              key={name}
              name={name}
              selected={isSelected}
              disabled={!canClick || pending}
              onSelect={() => void select(name)}
            >
              {canTest && (
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-6 max-md:size-10 shrink-0 cursor-pointer items-center justify-center rounded-control border border-border bg-card p-0 text-muted-foreground transition-all duration-150 hover:border-brand hover:bg-brand-soft hover:text-brand-text",
                    isTesting
                      ? "animate-pulse text-brand-text opacity-70"
                      : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
                  )}
                  title={t("testNode")}
                  aria-label={t("testNodeAria", { name })}
                  disabled={progress.running || isTesting}
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

              <button
                type="button"
                className={cn(
                  "inline-flex size-6 max-md:size-10 shrink-0 cursor-pointer items-center justify-center rounded-control border border-border bg-card p-0 text-muted-foreground transition-all duration-150 hover:border-brand hover:bg-brand-soft hover:text-brand-text",
                  isPinned(name)
                    ? "border-warning/40 text-warning-text hover:text-foreground"
                    : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
                )}
                title={isPinned(name) ? t("unpin") : t("pin")}
                aria-label={isPinned(name) ? t("unpin") : t("pin")}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(name);
                }}
              >
                <Pin
                  className={cn("size-3", isPinned(name) && "fill-current")}
                />
              </button>

              <span
                className={cn(
                  "inline-block rounded-full px-1.5 py-0.5 text-label font-semibold whitespace-nowrap tabular-nums",
                  DELAY_PILL_TONES[delayTone],
                )}
              >
                {delayDisplay}
              </span>
            </StrategyChoice>
          );
        })}
      </ul>
    </div>
  );
}
