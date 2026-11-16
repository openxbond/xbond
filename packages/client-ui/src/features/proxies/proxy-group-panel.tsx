import { useMediaQuery } from "@react-hookz/web";
import type { Group as IGroup } from "@xbond/client/request";
import { strategyPath } from "@xbond/client/workspace";
import { ArrowUpDown, Crosshair, Pin, Search, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { StrategyChoice, StrategyPath } from "@/components/proxy-strategy";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/platform/host";
import { usePinnedNodes } from "@/state/user-preferences";

import {
  DELAY_PILL_BASE,
  DELAY_PILL_DOTS,
  DELAY_PILL_TONES,
  hasDelayDot,
  type DelayPillTone,
} from "./delay-pill";
import { useLatency } from "./latency-context";
import { useProxyMapping } from "./proxy-data";
import { useNodeSelection } from "./use-node-selection";

/** 遞歸解析策略組最終指向的真實葉子節點與完整路徑 */
function resolveLeaf(
  name: string,
  mapping: Map<string, unknown>,
  seen = new Set<string>(),
): { leafName: string; path: string[] } {
  if (seen.has(name)) return { leafName: name, path: [] };
  seen.add(name);
  const item = mapping.get(name);
  if (
    item &&
    typeof item === "object" &&
    "now" in item &&
    typeof item.now === "string" &&
    item.now &&
    item.now !== name
  ) {
    const next = resolveLeaf(item.now, mapping, seen);
    return { leafName: next.leafName, path: [item.now, ...next.path] };
  }
  return { leafName: name, path: [] };
}

const LEADING_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic})\uFE0F?\s*/u;

/** 群組名與葉子節點同為國家/地區時，詳情只留國家之後的區分資訊。 */
function leafDetailLabel(groupName: string, leafName: string): string {
  const groupLabel = groupName.replace(LEADING_EMOJI, "").trim();
  const prefix = leafName.match(LEADING_EMOJI)?.[0] ?? "";
  const rest = leafName.slice(prefix.length);
  if (!groupLabel || !rest.startsWith(groupLabel)) return leafName;
  const tail = rest.slice(groupLabel.length).replace(/^[\s·›-]+/, "");
  return tail ? `${prefix}${tail}`.trim() : leafName;
}

export function Group({
  config,
  search = "",
  hasGroupSelector = false,
}: {
  config: IGroup;
  search?: string;
  hasGroupSelector?: boolean;
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
  const { t: tc } = useTranslation("common");
  const { isPinned, togglePin } = usePinnedNodes();
  const isMobile = useIsMobile();
  // 工作台在 lg 以上才把群組標題與工具列並排；更窄時工具列進卡片，
  // 避免在只有按鈕的一行裡留下大片空白。
  const wideLayout = useMediaQuery("(min-width: 1024px)") === true;
  const cardToolbar = !wideLayout;
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "latency" | "name">(
    "default",
  );
  const gridRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [cardToolbar, filterOpen]);

  const path = strategyPath(config, mapping);
  const delayFor = (name: string) => {
    const result = results[name];
    if (result?.delay !== undefined) return result.delay;
    const directDelay = mapping.get(name)?.history?.at(-1)?.delay;
    if (directDelay !== undefined) return directDelay;
    const leaf = resolveLeaf(name, mapping);
    if (leaf.leafName !== name) {
      return (
        results[leaf.leafName]?.delay ??
        mapping.get(leaf.leafName)?.history?.at(-1)?.delay
      );
    }
    return undefined;
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

  const delays = new Map(names.map((name) => [name, delayFor(name)]));
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

  function closeFilter() {
    setFilter("");
    setFilterOpen(false);
  }

  function toggleFilter() {
    if (filterOpen) closeFilter();
    else setFilterOpen(true);
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

  const groupTitle = (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2",
        hasGroupSelector && "max-lg:hidden",
      )}
    >
      <h3 className="m-0 min-w-0 text-sm xl:text-base font-bold text-foreground break-words">
        {config.name}
      </h3>
      <Badge
        variant="secondary"
        className="shrink-0 text-caption xl:text-xs px-1.5 py-0.2"
      >
        {config.type}
      </Badge>
      <span className="text-xs text-muted-foreground font-medium shrink-0 whitespace-nowrap">
        {t("groupMembers", { count: config.all.length })}
      </span>
    </div>
  );

  // 鏈行從下級開始：首枚 chip 是組本身，與面板標題重複。
  const groupPath =
    path.length > 1 ? (
      <div className="min-w-0 max-w-full">
        <StrategyPath path={path.slice(1)} nowrap={cardToolbar} />
      </div>
    ) : null;

  const groupDetails = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {groupTitle}
      {groupPath}
    </div>
  );

  const mobileActionClass =
    "flex h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 bg-card px-1 text-caption font-medium text-muted-foreground transition-[color,background-color] duration-150 hover:bg-inset/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45 focus-visible:ring-inset active:bg-inset disabled:cursor-default disabled:opacity-40";

  // 窄屏：工具列併入節點卡片，與清單共用同一個工作面；搜尋以同一高度
  // 原地替換整列，只淡入不改變尺寸，避免展開時換行造成的閃動。
  const mobileToolbar = filterOpen ? (
    <div className="relative flex h-11 items-center overflow-hidden rounded-control border border-brand/60 bg-card shadow-2xs animate-in fade-in-50 duration-150">
      <Search
        className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70"
        aria-hidden="true"
      />
      <input
        ref={filterRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        className="h-full w-full min-w-0 bg-transparent pr-11 pl-9 text-body text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder={t("filterNodes")}
        aria-label={t("filterNodes")}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeFilter();
        }}
      />
      <button
        type="button"
        className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-inset hover:text-foreground"
        onClick={closeFilter}
        aria-label={tc("close")}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  ) : (
    <div className="grid grid-cols-4 gap-px overflow-hidden rounded-control bg-border/50 ring-1 ring-border/70 ring-inset">
      <button
        type="button"
        className={mobileActionClass}
        title={t("locate")}
        aria-label={t("locate")}
        disabled={!config.now}
        onClick={locateSelected}
      >
        <Crosshair className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("toolLocate")}</span>
      </button>
      <button
        type="button"
        className={mobileActionClass}
        title={t("groupTest")}
        aria-label={t("toolTest")}
        disabled={progress.running || !names.length}
        onClick={runGroupTests}
      >
        <Zap className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("toolTest")}</span>
      </button>
      <button
        type="button"
        className={cn(
          mobileActionClass,
          sortMode !== "default" && "bg-brand-soft text-brand-text",
        )}
        title={t("sortState", { mode: sortLabel })}
        aria-label={t("sortState", { mode: sortLabel })}
        onClick={cycleSort}
      >
        <ArrowUpDown className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {sortMode === "default" ? t("toolSort") : sortLabel}
        </span>
      </button>
      <button
        type="button"
        className={mobileActionClass}
        title={t("filterNodes")}
        aria-label={t("filterNodes")}
        aria-expanded={filterOpen}
        onClick={toggleFilter}
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("toolFilter")}</span>
      </button>
    </div>
  );

  return (
    <div className="flex h-full animate-in flex-col gap-3 fade-in-50 slide-in-from-bottom-1 duration-200 lg:p-3.5 xl:p-4.5">
      {/* 桌面：群組標題與工具列共用同一列；窄屏改由卡片內的
          工具列承擔（下方渲染），頁首不再出現孤立按鈕。 */}
      {!cardToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 lg:border-b lg:border-border/80 lg:pb-3">
          <div className="hidden min-w-0 flex-1 lg:block">{groupDetails}</div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
            <div
              className={cn(
                "overflow-hidden opacity-0 max-w-0 transition-[max-width,opacity] duration-200 ease-expo",
                filterOpen && "max-w-[150px] sm:max-w-[180px] opacity-100",
              )}
            >
              <input
                ref={filterRef}
                type="text"
                className="h-7 w-[140px] sm:w-[170px] rounded-lg border border-border/80 bg-inset px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-brand"
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

            <div className="flex items-center gap-0.5 rounded-xl border border-border/80 bg-inset/50 p-0.5 shadow-2xs">
              <button
                type="button"
                className="inline-flex size-6.5 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-card hover:text-foreground hover:shadow-2xs disabled:opacity-40"
                title={t("locate")}
                aria-label={t("locate")}
                disabled={!config.now}
                onClick={locateSelected}
              >
                <Crosshair className="size-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="inline-flex size-6.5 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-card hover:text-foreground hover:shadow-2xs disabled:opacity-40"
                title={t("groupTest")}
                aria-label={t("groupTest")}
                disabled={progress.running || !names.length}
                onClick={runGroupTests}
              >
                <Zap className="size-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={cn(
                  "inline-flex size-6.5 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-card hover:text-foreground hover:shadow-2xs",
                  sortMode !== "default" &&
                    "bg-brand-soft text-brand-text font-bold shadow-2xs border border-brand/20",
                )}
                title={t("sortState", { mode: sortLabel })}
                aria-label={t("sortState", { mode: sortLabel })}
                onClick={cycleSort}
              >
                <ArrowUpDown className="size-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={cn(
                  "inline-flex size-6.5 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-card hover:text-foreground hover:shadow-2xs",
                  (filterOpen || filter) &&
                    "bg-brand-soft text-brand-text shadow-2xs border border-brand/20",
                )}
                title={t("filterNodes")}
                aria-label={t("filterNodes")}
                onClick={toggleFilter}
              >
                <Search className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 max-lg:rounded-card max-lg:border max-lg:border-border max-lg:bg-card max-lg:p-3.5 max-lg:shadow-elevation-card">
        {cardToolbar ? (
          <>
            {!hasGroupSelector && groupTitle}
            {mobileToolbar}
            {groupPath}
          </>
        ) : (
          <div className="lg:hidden">{groupDetails}</div>
        )}

        {(pending || selectionStatus !== "idle") && (
          <p
            className={cn(
              "m-0 animate-in rounded-control bg-inset px-3 py-2 text-label text-success-text fade-in-50 slide-in-from-top-1 duration-200",
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
          inside this grid so the group tools stay pinned above it.
          auto-rows-max：行高跟隨內容；stretch 項目的 auto 行只認 min-height，
          會把詳情行壓成 42px（桌面端詳情被裁切）。 */}
        <ul
          className="m-0 grid auto-rows-max list-none content-start gap-1.5 xl:gap-2 overflow-y-auto p-1 pr-1.5 grid-cols-1 [min(100%,760px)]:grid-cols-1 2xl:grid-cols-2 md:min-h-0 md:flex-1 [scrollbar-width:thin]"
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

            let delayTone: DelayPillTone = "untested";
            let delayDisplay: string = t("untested");
            if (isBuiltin) {
              delayTone = "builtin";
              delayDisplay = t("builtin");
            } else if (isTesting) {
              delayTone = "testing";
              delayDisplay = t("testing");
            } else if (isFailed) {
              delayTone = "failed";
              delayDisplay =
                status === "timedOut" ? t("timedOut") : t("failed");
            } else if (delay !== undefined && delay > 0) {
              if (delay < 150) delayTone = "fast";
              else if (delay <= 400) delayTone = "medium";
              else delayTone = "slow";
              delayDisplay = `${delay} ms`;
            }

            const leaf = resolveLeaf(name, mapping);
            const isGroup = "all" in (item ?? {});
            // 窄屏只留最終出口，避免長鏈路擠掉節點名；桌面保留完整鏈路。
            const detailLabel =
              leaf.path.length > 1 && !cardToolbar
                ? leaf.path.join(" › ")
                : leafDetailLabel(name, leaf.leafName);
            const displayDetail =
              isGroup && leaf.leafName !== name ? detailLabel : undefined;

            return (
              <StrategyChoice
                key={name}
                name={name}
                selected={isSelected}
                disabled={!canClick || pending}
                onSelect={() => void select(name)}
                detail={displayDetail}
              >
                {/* 桌面端懸停測速按鈕 */}
                {!isMobile && canTest && (
                  <button
                    type="button"
                    className={cn(
                      "size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-card p-0 text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text active:scale-[0.98]",
                      isTesting
                        ? "inline-flex animate-pulse text-brand-text opacity-70"
                        : "hidden group-hover:inline-flex focus-visible:inline-flex",
                    )}
                    title={t("testNode")}
                    aria-label={t("testNodeAria", { name })}
                    disabled={progress.running || isTesting}
                    onClick={(e) => {
                      e.stopPropagation();
                      const target =
                        isGroup && leaf.leafName ? leaf.leafName : name;
                      void run([target]);
                    }}
                  >
                    <Zap
                      className={cn(
                        "size-3",
                        isTesting && "fill-current animate-bounce",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                )}

                {/* 置頂狀態與按鈕：已置頂在移動端和桌面端都顯示釘子；未置頂在移動端隱藏，桌面端懸停顯示 */}
                <button
                  type="button"
                  className={cn(
                    "size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-card p-0 text-muted-foreground transition-all duration-150 hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text active:scale-[0.98]",
                    isPinned(name)
                      ? "inline-flex border-warning/50 bg-warning/10 text-warning hover:text-foreground"
                      : isMobile
                        ? "hidden"
                        : "hidden group-hover:inline-flex focus-visible:inline-flex",
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

                {/* 延遲藥丸：移動端點擊直接單獨測速，桌面端亦支援點擊測速 */}
                <button
                  type="button"
                  disabled={progress.running || isTesting || !canTest}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canTest) {
                      const target =
                        isGroup && leaf.leafName ? leaf.leafName : name;
                      void run([target]);
                    }
                  }}
                  className={cn(
                    DELAY_PILL_BASE,
                    DELAY_PILL_TONES[delayTone],
                    "whitespace-nowrap select-none shrink-0 transition-all duration-200",
                    canTest &&
                      !isTesting &&
                      "cursor-pointer active:scale-[0.98] hover:opacity-90",
                  )}
                  title={canTest ? t("testNodeAria", { name }) : undefined}
                >
                  {hasDelayDot(delayTone) && (
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full bg-current",
                        DELAY_PILL_DOTS[delayTone],
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {isTesting && (
                    <Zap
                      className="size-2.5 animate-bounce fill-current"
                      aria-hidden="true"
                    />
                  )}
                  {delayDisplay}
                </button>
              </StrategyChoice>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
