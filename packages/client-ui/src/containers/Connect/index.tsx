import { Button, CountryFlag, Segmented } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
import { Sheet, SheetContent, SheetTitle } from "@components/ui/sheet";
import { useAction } from "@lib/actions";
import { useNodeSelection } from "@lib/node-selection";
import { cn } from "@lib/utils";
import {
  useAPIInfo,
  useClient,
  useGeneral,
  useLocalAPI,
  useProxy,
  useProxyMapping,
  useStreamReader,
  useStreamState,
  identityAtom,
} from "@stores";
import { formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import {
  focusedGroup,
  strategyPath,
  controllerIdentity,
} from "@xbond/client/workspace";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TrafficChart, type TrafficSample } from "./chart";
import { NodePicker, latencyClass } from "./NodePicker";

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

/** 格式化流量速率，如 12.5 MB/s, 3.2 MB/s */
function formatDisplayRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytesPerSec || 1) / Math.log(1024)),
  );
  const val = bytesPerSec / Math.pow(1024, exp);
  const formatted = val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted} ${units[exp]}`;
}

/** 格式化累计/总量流量，如 1.8 GB, 392 GB, 500 GB */
function formatDisplayTraffic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes || 1) / Math.log(1024)),
  );
  const val = bytes / Math.pow(1024, exp);
  const formatted = val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted} ${units[exp]}`;
}

/* 任務卡（乳白實面、髮邊、卡片陰影），四張卡共用。 */
const cardSurface =
  "rounded-card border border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] bg-[color:color-mix(in_srgb,var(--card)_96%,transparent)] shadow-elevation-card";

/* 連線主操作：品牌橙圓形電源鍵，深色電源符號，克制光環。 */
const orbBase =
  "relative grid size-[124px] max-md:size-24 shrink-0 cursor-pointer place-items-center mt-2.5 mb-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-8 disabled:cursor-not-allowed disabled:opacity-60 [transition:transform_var(--duration-fast)_var(--ease-out-expo),box-shadow_var(--duration-base)_var(--ease-out-expo)] motion-reduce:[transition:none] enabled:hover:shadow-[inset_0_0_0_1px_var(--brand),0_10px_28px_-12px_var(--brand-text)] enabled:active:[transform:scale(0.97)]";
const orbOn =
  "bg-[image:var(--orb-gradient)] text-brand-foreground shadow-[inset_0_2px_3px_rgba(255,255,255,0.65),inset_0_-4px_8px_rgba(0,0,0,0.22),var(--orb-glow)]";
const orbOff =
  "border border-border bg-[image:var(--orb-off-gradient)] text-muted-foreground shadow-[var(--orb-off-inset-shadow),0_4px_14px_rgba(0,0,0,0.05)]";

function FactIcon({ kind }: { kind: "core" | "takeover" | "egress" }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "opacity-[0.85]",
    "aria-hidden": true,
  };
  if (kind === "core") {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      </svg>
    );
  }
  if (kind === "takeover") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="18" cy="6" r="2.6" />
        <circle cx="12" cy="18" r="2.6" />
        <path d="M7.8 7.6 10.4 16M16.2 7.6 13.6 16M8.6 6h6.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/**
 * 策略组横向滑动胶囊容器：
 * 支持桌面端鼠标拖拽横向滚动 (Drag-to-Scroll)、鼠标滚轮横向滚动、左右微型翻页箭头及触摸平滑滚动。
 */
function ScrollablePills({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isMouseDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    updateScrollState();
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollState]);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    isMouseDownRef.current = true;
    startXRef.current = e.pageX - el.offsetLeft;
    scrollLeftRef.current = el.scrollLeft;
    hasDraggedRef.current = false;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    if (Math.abs(walk) > 4) {
      hasDraggedRef.current = true;
    }
    el.scrollLeft = scrollLeftRef.current - walk;
    updateScrollState();
  };

  const onMouseUpOrLeave = () => {
    isMouseDownRef.current = false;
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 50);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (hasDraggedRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (e.deltaY !== 0 && !e.shiftKey && el.scrollWidth > el.clientWidth) {
      el.scrollLeft += e.deltaY;
      updateScrollState();
    }
  };

  const scrollByAmount = (offset: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollBy({ left: offset, behavior: "smooth" });
  };

  return (
    <div
      className={cn("relative group/pills flex items-center w-full", className)}
    >
      {canScrollLeft && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => scrollByAmount(-180)}
          className="absolute -left-2 z-10 grid size-6 place-items-center rounded-full bg-card/95 text-muted-foreground shadow-md border border-border/80 backdrop-blur-sm hover:text-foreground hover:bg-card cursor-pointer transition-opacity max-md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUpOrLeave}
        onMouseLeave={onMouseUpOrLeave}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
        onScroll={updateScrollState}
        className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] cursor-grab active:cursor-grabbing select-none w-full"
      >
        {children}
      </div>

      {canScrollRight && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => scrollByAmount(180)}
          className="absolute -right-2 z-10 grid size-6 place-items-center rounded-full bg-card/95 text-muted-foreground shadow-md border border-border/80 backdrop-blur-sm hover:text-foreground hover:bg-card cursor-pointer transition-opacity max-md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function Connect() {
  const { t } = useTranslation("connect");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const { t: st } = useTranslation("settings");
  const controller = useAPIInfo();
  const client = useClient();
  const { general, update } = useGeneral();
  const nodeSelection = useNodeSelection();
  const { groups, global, isLoading: proxiesLoading } = useProxy();
  const mapping = useProxyMapping();
  const {
    hasLocalAPI,
    isLocalTarget,
    status,
    up,
    down,
    setMode,
    refresh,
    config: localConfig,
    error: localError,
  } = useLocalAPI();
  const { run, pending } = useAction();
  const setIdentity = useSetAtom(identityAtom);
  const [focus, setFocus] = useAtom(focusAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [takeoverSheetOpen, setTakeoverSheetOpen] = useState(false);

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controllerIdentity(controller.id, controller.url);
  const group =
    (focus[focusKey]
      ? available.find((g) => g.name === focus[focusKey])
      : null) ??
    focusedGroup(available, focus[focusKey]) ??
    available[0] ??
    null;
  const chain = strategyPath(group, mapping);

  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<TrafficSample[]>([]);

  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      setSpeed(items.at(-1) ?? null);
      const latest = items.at(-1);
      if (latest) {
        const at = Date.now();
        setHistory((previous) => [...previous, { ...latest, at }].slice(-60));
      }
    };
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);

  useEffect(() => {
    const onData = (items: Snapshot[]) => setSnapshot(items.at(-1) ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);

  // 重新連上串流時清空樣本：跨越失聯時段的線段不是真實走勢。
  const previousTrafficState = useRef(trafficState);
  useEffect(() => {
    if (trafficState === "open" && previousTrafficState.current !== "open") {
      setHistory([]);
      setSpeed(null);
    }
    previousTrafficState.current = trafficState;
  }, [trafficState]);

  const running = hasLocalAPI && (status?.engine.running ?? false);
  const sub = hasLocalAPI ? (status?.activeSub ?? null) : null;
  const quota = subscriptionQuota(sub);
  const coreOpen = trafficState === "open";
  const active = hasLocalAPI ? running : !isLocalTarget && coreOpen;
  const takeover = hasLocalAPI ? status?.preferences.takeoverMode : undefined;
  const currentMode = (
    hasLocalAPI ? status?.preferences.routingMode : general.mode
  )?.toLowerCase();
  const mixedPort = hasLocalAPI
    ? status?.engine.mixedPort || 7890
    : general.mixedPort || 7890;

  // Latest known delay for a node, from the same history the proxies page reads.
  const nodeDelay = (name: string) => {
    const item = mapping.get(name);
    if (!item || !("history" in item)) return null;
    const last = item.history[item.history.length - 1];
    return last && last.delay > 0 ? last.delay : null;
  };

  const leafNodeName =
    chain.length > 0 ? chain[chain.length - 1] : (group?.now ?? "");
  const leafFlag = leafNodeName ? nodeFlagCode(leafNodeName) : null;
  const leafDelay = leafNodeName ? nodeDelay(leafNodeName) : null;
  const isDirect = leafNodeName.toLowerCase() === "direct";
  const isReject = leafNodeName.toLowerCase() === "reject";

  const uptimeClock = running ? formatUptimeClock(status?.engine.uptime) : null;
  const sessionTotal =
    connectionState === "open" && snapshot
      ? snapshot.downloadTotal + snapshot.uploadTotal
      : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;

  const stateWord = hasLocalAPI
    ? running
      ? t("connected")
      : t("stopped")
    : trafficState === "open"
      ? t("coreReachable")
      : r(trafficState);
  // 運行時的副行交代接管方式；未運行交代下一步，遠端交代管理歸屬。
  const stateNote = hasLocalAPI
    ? running
      ? takeover === "sysproxy"
        ? t("runningSysproxy")
        : takeover === "tun"
          ? t("runningTun")
          : t("runningPort", { port: mixedPort })
      : sub
        ? t("readyToConnect")
        : t("noConfig")
    : t("remoteNote");

  const facts = [
    {
      kind: "core" as const,
      tone: active ? "brand" : "muted",
      label: t("tiers.core"),
      value: hasLocalAPI
        ? status?.engine.running
          ? t("coreRunning")
          : t("stopped")
        : r(trafficState),
    },
    {
      kind: "takeover" as const,
      tone: hasLocalAPI
        ? takeover === "port"
          ? "muted"
          : status?.threeTier.trafficIntercepted
            ? "ok"
            : "muted"
        : "muted",
      label: t("takeoverMode"),
      value: takeover ? t(takeover) : tc("unknown"),
    },
    {
      kind: "egress" as const,
      tone: status?.threeTier.egressVerified ? "ok" : "muted",
      label: t("tiers.egress"),
      value: status?.threeTier.egressVerified
        ? status.threeTier.egressLatencyMs > 0
          ? `${status.threeTier.egressLatencyMs}ms`
          : t("egressVerified")
        : tc("unknown"),
    },
  ];

  function setFocusGroup(name: string) {
    setFocus((previous) => ({ ...previous, [focusKey]: name }));
  }

  const takeoverOptions = (["sysproxy", "tun", "port"] as const).map(
    (mode) => ({
      value: mode,
      label: t(mode),
      disabledReason:
        mode === "tun" && status?.capabilities?.tun === false
          ? (status.capabilities.tunReason ?? undefined)
          : undefined,
    }),
  );

  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: tc(`routingMode.${mode}`),
    }),
  );
  // Segmented 的泛型由 options 收窄；value 只在當前模式確實是三擋之一時傳入。
  const routingValue = routingOptions.find(
    (option) => option.value === currentMode,
  )?.value;

  async function switchRouting(mode: "rule" | "global" | "direct") {
    await run(async () => {
      if (hasLocalAPI) {
        await setMode({ routing: mode });
      } else {
        await client.updateConfig({ mode });
        await update();
      }
    }, false);
  }

  return (
    <div className="page w-full">
      {localConfig && !status && (
        <div
          className="flex items-center justify-between gap-3 rounded-control border border-border bg-card px-4 py-3 text-sm"
          role={localError ? "alert" : "status"}
        >
          <span>{localError ? t("statusReadFailed") : tc("loading")}</span>
          {localError && (
            <Button
              disabled={pending}
              onClick={() => void run(() => refresh(), false)}
            >
              {tc("retry")}
            </Button>
          )}
        </div>
      )}

      <div className="grid w-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 [grid-template-areas:'control_aside'_'live_live'] max-md:grid-cols-1 max-md:[grid-template-areas:'control'_'aside'_'live']">
        <section
          className={cn(
            cardSurface,
            "[grid-area:control] flex flex-col items-center justify-center gap-2.5 pt-8 px-7 pb-6 text-center max-md:pt-7 max-md:px-5 max-md:pb-5",
          )}
          aria-label={t("connect")}
        >
          {hasLocalAPI ? (
            <button
              type="button"
              className={cn(orbBase, active ? orbOn : orbOff)}
              disabled={pending || (!running && !sub)}
              aria-pressed={active}
              aria-label={`${stateWord} — ${running ? t("disconnect") : t("connect")}`}
              onClick={() => void run(() => (running ? down() : up()), false)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -inset-2 rounded-full border-[1.5px]",
                  active
                    ? "animate-[native-breathe_2.4s_ease-in-out_infinite] border-[color:color-mix(in_srgb,var(--brand)_45%,transparent)] motion-reduce:animate-none"
                    : "border-[color:color-mix(in_srgb,var(--border)_80%,transparent)]",
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -inset-[38px] rounded-full",
                  active ? "bg-[image:var(--orb-halo)]" : "hidden",
                )}
              />
              {pending ? (
                <span
                  aria-hidden="true"
                  className="size-[30px] animate-[native-spin_0.8s_linear_infinite] rounded-full border-[3px] border-current border-t-transparent"
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className={cn(
                    "size-10 max-md:size-8",
                    active && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]",
                  )}
                >
                  <path d="M12 2v10" />
                  <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
                </svg>
              )}
            </button>
          ) : (
            // A plain Clash-API remote has nothing this dashboard can start
            // or stop: the honest main action is managing the target itself.
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                className="group relative flex size-24 cursor-pointer items-center justify-center rounded-control border border-border bg-card p-0 shadow-elevation-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-elevation-raised"
                aria-label={t("manageController")}
                onClick={() => setIdentity(false)}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-1.5 rounded-control border border-brand/20 opacity-0 transition-opacity group-hover:opacity-100"
                />
                <span className="grid size-14 place-items-center rounded-control bg-brand-soft text-brand-text">
                  <svg
                    viewBox="0 0 24 24"
                    width="32"
                    height="32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </span>
              </button>
            </div>
          )}

          <h2 className="m-0 text-display font-bold leading-[1.25] tracking-[-0.02em] text-foreground max-md:text-headline">
            {stateWord}
          </h2>
          <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {stateNote}
          </p>
          {uptimeClock && (
            <p
              className="m-0 mt-1 text-subtitle font-medium font-mono tabular-nums text-muted-foreground max-md:hidden"
              aria-label={t("uptime", { duration: uptimeClock })}
            >
              {uptimeClock}
            </p>
          )}

          <ul className="mt-3.5 grid self-stretch list-none grid-cols-3 border-t border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] pt-[18px]">
            {facts.map((fact) => (
              <li
                key={fact.kind}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-[7px] border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] px-2 text-xs text-muted-foreground not-first:border-l",
                  fact.tone === "brand" && "text-brand-text",
                  fact.tone === "ok" && "text-success-text",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FactIcon kind={fact.kind} />
                  {fact.label}
                </span>
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      fact.tone === "brand"
                        ? "bg-brand"
                        : fact.tone === "ok"
                          ? "bg-success"
                          : "bg-muted-foreground opacity-55",
                    )}
                  />
                  <b
                    className={cn(
                      "text-sm font-semibold tabular-nums [overflow-wrap:anywhere]",
                      fact.tone === "brand"
                        ? "text-brand-text"
                        : fact.tone === "ok"
                          ? "text-success-text"
                          : "text-foreground",
                    )}
                  >
                    {fact.value}
                  </b>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2.5 self-stretch mt-4 border-t border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] px-1 pt-4 text-body text-muted-foreground max-md:hidden">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-control bg-inset text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0/55%)]"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12 2 9 5-9 5-9-5 9-5z" />
                <path d="m3 12 9 5 9-5" />
                <path d="m3 17 9 5 9-5" />
              </svg>
            </span>
            {sub ? (
              <span className="min-w-0 truncate">
                {t("currentConfig")}{" "}
                <b className="font-semibold text-foreground">{sub.name}</b>
              </span>
            ) : (
              <span className="min-w-0 truncate">
                {hasLocalAPI ? t("noConfig") : t("noConfigRemote")}
              </span>
            )}
            {hasLocalAPI && (
              <Link
                to="/config"
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-body font-semibold text-brand-text no-underline hover:underline hover:underline-offset-4"
              >
                {t("manage")}
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
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>
        </section>

        <div className="[grid-area:aside] flex min-w-0 flex-col gap-4">
          <section
            className={cn(
              cardSurface,
              "flex flex-col gap-3 py-4.5 px-5 max-md:p-4",
            )}
            aria-label={t("strategyGroups")}
          >
            {/* Header: 标题 + 策略组数量 + 全部策略跳转 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-subtitle font-semibold text-foreground">
                  {t("strategyGroups")}
                </h2>
                {available.length > 0 && (
                  <span className="rounded-full bg-inset px-2 py-0.5 text-label tabular-nums text-muted-foreground font-medium">
                    {available.length} {t("strategyMembers")}
                  </span>
                )}
              </div>
              <Link
                to="/proxies"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-text no-underline hover:underline hover:underline-offset-4"
              >
                {t("allStrategies")}
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </div>

            {/* 策略组横排胶囊切换标签 (支持桌面端鼠标拖拽横向滚动、滚轮横向滚动与微型翻页箭头) */}
            {available.length > 1 && (
              <ScrollablePills>
                {available.map((item) => {
                  const isCurrent = item.name === group?.name;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setFocusGroup(item.name)}
                      className={cn(
                        "shrink-0 cursor-pointer rounded-full px-3 py-1 max-md:min-h-11 max-md:px-4 text-xs font-medium transition-all duration-150 select-none",
                        isCurrent
                          ? "bg-brand text-brand-foreground shadow-sm font-semibold"
                          : "bg-inset text-muted-foreground hover:bg-card hover:text-foreground",
                      )}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </ScrollablePills>
            )}

            {/* 当前选中策略组的出站详情：卡内以发丝分隔线成组，不再套卡 */}
            <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
              {/* 组信息小标头：组名、类型 (Selector/URLTest/Fallback)、成员总数 */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {group ? group.name : t("strategy.title")}
                  </span>
                  {group?.type && (
                    <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                      {group.type}
                    </span>
                  )}
                </div>
                {group?.all && (
                  <span className="tabular-nums text-label">
                    {group.all.length} {t("strategyMembers")}
                  </span>
                )}
              </div>

              {/* 真实出站节点选择按钮 */}
              <button
                type="button"
                className="group flex w-full cursor-pointer items-center gap-3 text-left text-foreground pt-0.5"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
              >
                {/* 节点图标头像 (40px 圆角国旗 / 直连 / 拦截 / 服务器图标) */}
                <span
                  className="flex size-10 max-md:size-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-inset text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_60%,transparent),0_1px_3px_oklch(0.55_0.08_60/0.08)]"
                  aria-hidden="true"
                >
                  {isDirect ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  ) : isReject ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  ) : leafFlag ? (
                    <CountryFlag code={leafFlag} avatar className="size-full" />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="7" rx="2" />
                      <rect x="3" y="13" width="18" height="7" rx="2" />
                      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
                      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
                    </svg>
                  )}
                </span>

                {/* 节点名称、延迟与策略链路 */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className="truncate text-subtitle font-semibold text-foreground tracking-tight"
                    title={
                      leafNodeName
                        ? leafFlag
                          ? stripFlagEmoji(leafNodeName)
                          : leafNodeName
                        : undefined
                    }
                  >
                    {leafNodeName
                      ? leafFlag
                        ? stripFlagEmoji(leafNodeName)
                        : leafNodeName
                      : t("strategy.noNodeSelected")}
                  </span>

                  <span className="flex items-center gap-1.5 text-label tabular-nums text-muted-foreground">
                    {leafDelay ? (
                      <>
                        <b
                          className={cn(
                            "shrink-0 font-mono text-xs tabular-nums",
                            latencyClass(leafDelay),
                          )}
                        >
                          {leafDelay} ms
                        </b>
                        <span className="text-muted-foreground">
                          · {t("lastMeasured")}
                        </span>
                      </>
                    ) : leafNodeName ? (
                      px("untested")
                    ) : (
                      t("strategy.title")
                    )}
                  </span>

                  {/* 策略链路由链路 (若存在嵌套多级) */}
                  {chain.length > 2 && (
                    <span
                      className="mt-0.5 truncate text-label text-muted-foreground/75"
                      title={chain.join(" → ")}
                    >
                      {chain.join(" → ")}
                    </span>
                  )}
                </span>

                {/* 右侧进入箭头 */}
                <span className="flex shrink-0 items-center text-muted-foreground group-hover:text-brand-text transition-colors">
                  <span
                    className="grid size-7 place-items-center rounded-full bg-inset text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0/50%)] [transition:color_var(--duration-fast)_ease,background-color_var(--duration-fast)_ease] group-hover:bg-brand-soft group-hover:text-brand-text"
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </span>
              </button>
            </div>
          </section>

          <section
            className={cn(
              cardSurface,
              "flex flex-1 flex-col gap-3.5 py-5 px-[22px] max-md:p-[18px]",
            )}
            aria-label={t("prefs")}
          >
            <h2 className="text-subtitle font-semibold">{t("prefs")}</h2>
            {hasLocalAPI && (
              <div className="flex flex-col gap-2.5 border-t border-border/70 pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-label font-semibold text-muted-foreground">
                    {t("takeoverMode")}
                  </span>
                  <button
                    type="button"
                    className="ml-auto hidden max-md:inline-flex cursor-pointer items-center gap-1.5 rounded-control px-1.5 py-1 text-body font-semibold text-brand-text"
                    aria-haspopup="dialog"
                    onClick={() => setTakeoverSheetOpen(true)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>{takeover ? t(takeover) : tc("unknown")}</span>
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </div>
                <div className="max-md:hidden">
                  <Segmented
                    ariaLabel={t("takeoverMode")}
                    options={takeoverOptions}
                    value={takeover ?? null}
                    disabled={pending}
                    className="w-full justify-stretch"
                    onChange={(mode) =>
                      void run(() => setMode({ mode }), false)
                    }
                  />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5 border-t border-border/70 pt-3">
              <span className="text-label font-semibold text-muted-foreground">
                {tc("routingMode.title")}
              </span>
              <Segmented
                ariaLabel={tc("routingMode.title")}
                options={routingOptions}
                value={routingValue ?? null}
                disabled={pending}
                onChange={(mode) => void switchRouting(mode)}
              />
              {currentMode === "rule" ||
              currentMode === "global" ||
              currentMode === "direct" ? (
                <p className="m-0 text-label text-muted-foreground">
                  {t(`routingHint.${currentMode}`)}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section
          className={cn(
            cardSurface,
            "[grid-area:live] flex flex-col gap-4 py-5 px-6 max-md:p-4.5",
          )}
          aria-label={t("trafficStats")}
        >
          <h2 className="text-subtitle font-semibold text-foreground tracking-tight">
            {t("trafficStats")}
          </h2>

          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-6 max-md:grid-cols-1 max-md:gap-4">
            {/* Desktop Speeds: 左右横排，橙色箭头，中间发丝分割线 */}
            <div className="flex items-center gap-6 my-auto pr-2 max-md:hidden">
              {/* 下载速率 */}
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <svg
                    className="text-brand shrink-0"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 4v14M6 12l6 6 6-6" />
                  </svg>
                  {t("download")}
                </span>
                <b className="whitespace-nowrap text-title font-bold text-foreground tabular-nums tracking-tight">
                  {trafficState === "open" && speed
                    ? formatDisplayRate(speed.down)
                    : "—"}
                </b>
              </div>

              {/* 发丝分割线 */}
              <div className="h-8 w-px bg-border/80" aria-hidden="true" />

              {/* 上传速率 */}
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <svg
                    className="text-brand shrink-0"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20V6M6 12l6-6 6 6" />
                  </svg>
                  {t("upload")}
                </span>
                <b className="whitespace-nowrap text-title font-bold text-foreground tabular-nums tracking-tight">
                  {trafficState === "open" && speed
                    ? formatDisplayRate(speed.up)
                    : "—"}
                </b>
              </div>
            </div>

            {/* Mobile Speeds */}
            <div className="hidden max-md:flex max-md:items-center max-md:justify-between max-md:gap-4">
              <div className="flex flex-1 items-center gap-3">
                <div
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-success/10 text-success"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 4v14M6 12l6 6 6-6" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5">
                  <b className="text-subtitle font-bold text-foreground tabular-nums">
                    {trafficState === "open" && speed
                      ? formatDisplayRate(speed.down)
                      : "—"}
                  </b>
                  <span className="text-xs text-muted-foreground">
                    {t("download")}
                  </span>
                </div>
              </div>

              <div className="h-8 w-px bg-border/80" aria-hidden="true" />

              <div className="flex flex-1 items-center gap-3">
                <div
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20V6M6 12l6-6 6 6" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5">
                  <b className="text-subtitle font-bold text-foreground tabular-nums">
                    {trafficState === "open" && speed
                      ? formatDisplayRate(speed.up)
                      : "—"}
                  </b>
                  <span className="text-xs text-muted-foreground">
                    {t("upload")}
                  </span>
                </div>
              </div>
            </div>

            {/* 实时走势折线/面积图 */}
            <TrafficChart
              samples={history}
              title={t("trafficHistory")}
              empty={t("collectingSamples")}
              stale={trafficState !== "open"}
              staleLabel={t("streamStopped")}
              windowLabel={t("recentWindow")}
            />

            {/* Desktop Totals & Quota: 本次累计与剩余配额 */}
            <div className="flex min-w-[190px] flex-col justify-center gap-3.5 border-l border-border/80 pl-6 pr-1 max-md:hidden">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("sessionTotal")}
                </span>
                <b className="whitespace-nowrap text-title font-bold text-foreground tabular-nums tracking-tight">
                  {sessionTotal !== null
                    ? formatDisplayTraffic(sessionTotal)
                    : "—"}
                </b>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("quota.remaining")}
                </span>
                {sub && quota ? (
                  <>
                    <b className="whitespace-nowrap text-body font-bold text-foreground tabular-nums">
                      {formatDisplayTraffic(quota.remaining)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        / {formatDisplayTraffic(sub.total)}
                      </span>
                    </b>
                    <span
                      className="mt-1.5 block h-[7px] w-full overflow-hidden rounded-full bg-inset"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(quotaPercent ?? 0)}
                      aria-label={t("quota.remaining")}
                    >
                      <span
                        className="block h-full origin-left rounded-full bg-brand transition-all duration-300"
                        style={{
                          width: `${Math.round(quotaPercent ?? 0)}%`,
                        }}
                      />
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {sub
                      ? t("quota.unknown")
                      : hasLocalAPI
                        ? t("noConfig")
                        : t("quotaUnavailable")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile-only config row under speeds */}
          <div className="hidden max-md:mt-3.5 max-md:flex max-md:items-center max-md:gap-2.5 max-md:border-t max-md:border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] max-md:pt-3.5 max-md:text-body max-md:text-muted-foreground">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-control bg-inset text-muted-foreground"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate">
              <b className="font-semibold text-foreground">
                {sub
                  ? sub.name
                  : hasLocalAPI
                    ? t("noConfig")
                    : t("noConfigRemote")}
              </b>
              {sub && quota && (
                <span>
                  {` · ${t("quota.remaining")} ${formatDisplayTraffic(quota.remaining)}`}
                </span>
              )}
            </span>
            {hasLocalAPI && (
              <Link
                to="/config"
                className="ml-auto grid size-6 place-items-center text-muted-foreground"
                aria-label={t("manage")}
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
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>
        </section>
      </div>

      {/* 首次打開才掛載，避免常駐離屏層（Sheet 常駐會殘留 aria 節點）。 */}
      {pickerOpen && (
        <NodePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          groups={available}
          loading={proxiesLoading}
          focusGroupName={group?.name ?? null}
          onFocusGroup={setFocusGroup}
          chain={chain}
          nodeDelay={nodeDelay}
          mapping={mapping}
          selection={nodeSelection}
          onSelect={async (groupName, nodeName) => {
            setFocusGroup(groupName);
            await nodeSelection.select(groupName, nodeName);
          }}
        />
      )}

      {/* 流動端接管方式面板：桌面用分段滑塊，手機開底部面板（能力與原因相同）。 */}
      {takeoverSheetOpen && (
        <Sheet
          open
          onOpenChange={(sheetOpen) => {
            if (!sheetOpen) setTakeoverSheetOpen(false);
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-[340px] max-w-full overflow-y-auto sm:max-w-[340px]"
          >
            <div
              className="flex flex-col gap-3.5 py-5 px-[18px]"
              role="dialog"
              aria-modal="true"
              aria-label={t("takeoverMode")}
            >
              <header className="flex items-center justify-between">
                <SheetTitle asChild>
                  <h3 className="text-base font-semibold">
                    {t("takeoverMode")}
                  </h3>
                </SheetTitle>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center justify-center rounded-sm px-1.5 py-1 max-md:min-h-11 max-md:min-w-11 text-body font-semibold text-brand-text"
                  onClick={() => setTakeoverSheetOpen(false)}
                  aria-label={tc("close")}
                >
                  ✕
                </button>
              </header>
              <div className="flex flex-col gap-2">
                {takeoverOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-control border border-border bg-card px-3.5 py-3 text-left text-foreground enabled:hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-55",
                      takeover === option.value &&
                        "border-transparent bg-brand-soft",
                    )}
                    disabled={pending || option.disabledReason !== undefined}
                    title={option.disabledReason}
                    onClick={() =>
                      void run(() => setMode({ mode: option.value }), false)
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="text-sm font-semibold">{option.label}</b>
                      <span className="text-label text-muted-foreground">
                        {st(`takeover.${option.value}Desc` as const)}
                      </span>
                    </span>
                    {takeover === option.value && (
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-brand-text"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
