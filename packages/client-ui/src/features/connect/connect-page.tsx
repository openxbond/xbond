import { formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import { focusedGroup, strategyPath } from "@xbond/client/workspace";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { AlertCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { CountryFlag } from "@/components/country-flag";
import { nodeFlagCode, stripFlagEmoji } from "@/components/country-flag";
import { DisconnectedState } from "@/components/disconnected-state";
import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
import { useProxy, useProxyMapping } from "@/features/proxies/proxy-data";
import { useNodeSelection } from "@/features/proxies/use-node-selection";
import { errorKind, useAction } from "@/hooks/use-action";
import { useStreamReader, useStreamState } from "@/hooks/use-core-stream";
import { cn } from "@/lib/utils";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import { useAPIInfo, useClient, identityAtom } from "@/state/controller-target";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

import { ExternalControllerOnboarding } from "./external-controller-onboarding";
import { NodePicker, latencyClass } from "./node-picker";
import { OnboardingGuide } from "./onboarding-guide";
import { TrafficChart, type TrafficSample } from "./traffic-chart";

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

/* 工作面：實色、髮線邊，不用常駐陰影。 */
const cardSurface = "bento";

/* 連線主操作：品牌橙圓形電源鍵，深色電源符號，無光暈。 */
const orbBase =
  "relative grid size-[112px] max-md:size-[104px] shrink-0 cursor-pointer place-items-center rounded-full outline-none transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-[var(--ease-out-expo)] focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-55 enabled:hover:-translate-y-0.5 enabled:active:translate-y-0 enabled:active:scale-[0.98] motion-reduce:transition-none motion-reduce:enabled:hover:translate-y-0";
const orbOn =
  "gradient-brand text-brand-foreground shadow-[0_22px_48px_-16px_oklch(0.7_0.19_45/65%),inset_0_1px_0_oklch(1_0_0/35%)] hover:brightness-105";
const orbOff =
  "field-glass text-muted-foreground shadow-[0_18px_40px_-24px_oklch(0.2_0.03_265/35%)] hover:border-brand/60 hover:text-brand-text";

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
          className="absolute -left-2 z-10 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-xs hover:bg-inset hover:text-foreground cursor-pointer transition-colors max-md:hidden"
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
          className="absolute -right-2 z-10 grid size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-xs hover:bg-inset hover:text-foreground cursor-pointer transition-colors max-md:hidden"
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
    changeService,
    config: localConfig,
    error: localError,
  } = useLocalAPI();
  const { run, pending } = useAction();
  const setIdentity = useSetAtom(identityAtom);
  const [focus, setFocus] = useAtom(focusAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [changingService, setChangingService] = useState(false);
  const [privilegeDialogOpen, setPrivilegeDialogOpen] = useState(false);
  const [connectError, setConnectError] = useState<{
    kind: "port_conflict" | "tun_denied" | "generic";
    message: string;
  } | null>(null);

  // Sleep/wake recovery: re-synchronize when device wakes or network reconnects
  useEffect(() => {
    const handleWakeSync = () => {
      void refresh();
    };
    window.addEventListener("online", handleWakeSync);
    window.addEventListener("focus", handleWakeSync);
    return () => {
      window.removeEventListener("online", handleWakeSync);
      window.removeEventListener("focus", handleWakeSync);
    };
  }, [refresh]);

  const handleToggleConnection = async () => {
    setConnectError(null);
    if (running) {
      await run(() => down(), false);
    } else {
      let caught: unknown = null;
      const ok = await run(async () => {
        try {
          await up();
        } catch (err) {
          caught = err;
          throw err;
        }
      }, false);
      if (!ok && caught) {
        const resMsg =
          (caught as { response?: { data?: { error?: string } } })?.response
            ?.data?.error ||
          (caught as Error)?.message ||
          String(caught);
        if (/already in use|bind|port/i.test(resMsg)) {
          setConnectError({ kind: "port_conflict", message: resMsg });
        } else if (/tun|privilege|admin|permission/i.test(resMsg)) {
          setConnectError({ kind: "tun_denied", message: resMsg });
        } else {
          setConnectError({ kind: "generic", message: resMsg });
        }
      }
    }
  };

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controller.focusKey;
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
  const coreOpen = trafficState === "open" || Boolean(general.mode);
  const active = hasLocalAPI ? running : !isLocalTarget && coreOpen;
  const isSysproxy = hasLocalAPI
    ? (status?.preferences.systemProxy ??
      status?.preferences.takeoverMode === "sysproxy")
    : false;
  const isTun = hasLocalAPI
    ? (status?.preferences.tun ?? status?.preferences.takeoverMode === "tun")
    : false;
  const isServiceInstalled = hasLocalAPI
    ? Boolean(status?.capabilities?.serviceInstalled)
    : false;
  const isTunCapable = hasLocalAPI
    ? Boolean(
        status?.capabilities?.serviceInstalled || status?.capabilities?.tun,
      )
    : false;
  const [optimisticRouting, setOptimisticRouting] = useState<
    "rule" | "global" | "direct" | null
  >(null);
  const currentMode = (
    optimisticRouting ??
    (hasLocalAPI ? status?.preferences.routingMode : general.mode)
  )?.toLowerCase();
  const mixedPort = hasLocalAPI
    ? status?.engine.mixedPort || 7890
    : general.mixedPort || 7890;

  const handleChangeService = useCallback(
    async (install: boolean) => {
      const key = install ? "install" : "uninstall";
      setChangingService(true);
      try {
        toast.info(st(`takeover.${key}ServicePrompt`));
        const done = await changeService(install);
        if (!done) {
          toast.error(
            st(`takeover.${key}ServiceFailed`, {
              error: st("takeover.serviceChangeTimeout"),
            }),
          );
          return;
        }
        toast.success(st(`takeover.${key}ServiceSuccess`));
        if (install) {
          void run(() => setMode({ tun: true }), false);
        } else if (isTun) {
          void run(() => setMode({ tun: false }), false);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(st(`takeover.${key}ServiceFailed`, { error: msg }));
      } finally {
        setChangingService(false);
      }
    },
    [changeService, isTun, run, setMode, st],
  );

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
      ? isSysproxy && isTun
        ? t("runningDual")
        : isSysproxy
          ? t("runningSysproxy")
          : isTun
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
      tone: hasLocalAPI ? (isSysproxy || isTun ? "ok" : "muted") : "muted",
      label: t("takeoverMode"),
      value: hasLocalAPI
        ? isSysproxy && isTun
          ? `${t("sysproxy")} + TUN`
          : isSysproxy
            ? t("sysproxy")
            : isTun
              ? t("tun")
              : t("portOnly")
        : tc("unknown"),
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

  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: tc(`routingMode.${mode}`),
    }),
  );
  const routingValue = routingOptions.find(
    (option) => option.value === currentMode,
  )?.value;

  async function switchRouting(mode: "rule" | "global" | "direct") {
    setOptimisticRouting(mode);
    try {
      if (hasLocalAPI) {
        await setMode({ routing: mode });
      } else {
        if (!client) throw new Error("LocalAPI not available");
        await client.updateConfig({ mode });
        await update();
      }
    } catch (err) {
      toast.error(r(errorKind(err)), { duration: 6000 });
    } finally {
      setOptimisticRouting(null);
    }
  }

  return (
    <div className="page @container/connect w-full">
      {localConfig && !status && (
        <div
          className="bento flex items-center justify-between gap-3 p-4 text-[13px]"
          role={localError ? "alert" : "status"}
        >
          <span className="text-muted-foreground">
            {localError ? t("statusReadFailed") : tc("loading")}
          </span>
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

      {hasLocalAPI && !sub ? (
        <OnboardingGuide className="my-auto py-6" />
      ) : isLocalTarget && !hasLocalAPI ? (
        // 本機 daemon 離線：保留本機身份與重試入口，不顯示遠端控制器視圖。
        <DisconnectedState className="my-auto py-6" />
      ) : !hasDaemonConfig() && !active ? (
        <ExternalControllerOnboarding className="my-auto py-6" />
      ) : (
        /* 兩欄檻位 = 44rem（704px 容器內容盒）：桌面默認視窗 1140px 扣側欄、
           頁邊距後內容盒 ~782px 一定能兩欄；容器再小（~1042px 視口以下）
           落回單列堆疊。52rem 時默認視窗的內容盒只有 ~797px 太窄。 */
        <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-4 [grid-template-areas:'control'_'strategy'_'prefs'_'live'] @min-[44rem]/connect:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)] @min-[44rem]/connect:grid-rows-[auto_auto] @min-[44rem]/connect:[grid-template-areas:'control_strategy'_'live_prefs']">
          <section
            className={cn(
              cardSurface,
              // 默認視窗要能不出捲軸：hero 上緣收緊（晶片是絕對定位，36px 足夠），
              // 兩欄後行高由內容決定，min-h 只在數據空時兜底。
              "[grid-area:control] bento-hero bento-interactive relative flex min-h-[320px] flex-col items-center justify-start gap-2 overflow-hidden px-6 pt-9 pb-0 text-center max-md:min-h-0 max-md:px-4 max-md:pt-10",
            )}
            aria-label={t("connect")}
          >
            <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-white/45 px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:bg-white/10">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    active
                      ? "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]"
                      : "bg-muted-foreground/45",
                  )}
                />
                {t("connect")}
              </span>
              <span className="max-w-[55%] truncate rounded-full border border-[var(--glass-border)] bg-white/35 px-2.5 py-1 font-mono text-[10px] tracking-tight text-muted-foreground dark:bg-white/10">
                {controller.targetKind === "daemon"
                  ? `127.0.0.1:${mixedPort}`
                  : controller.hostname}
              </span>
            </div>
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2">
              {hasLocalAPI ? (
                <button
                  type="button"
                  className={cn(orbBase, active ? orbOn : orbOff)}
                  disabled={pending || (!running && !sub)}
                  aria-pressed={active}
                  aria-label={`${stateWord} — ${running ? t("disconnect") : t("connect")}`}
                  onClick={() => void handleToggleConnection()}
                >
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
                      className="size-10 max-md:size-8"
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
                    className="group relative flex size-20 cursor-pointer items-center justify-center rounded-card border border-border-strong bg-card p-0 transition-colors duration-150 hover:border-brand/70 hover:bg-brand-soft/40"
                    aria-label={t("manageController")}
                    onClick={() => setIdentity(false)}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-1.5 rounded-control border border-brand/20 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                    <span className="grid size-12 place-items-center rounded-control bg-brand-soft text-brand-text">
                      <svg
                        viewBox="0 0 24 24"
                        width="28"
                        height="28"
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
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-sm font-semibold text-foreground">
                      {controller.targetKind === "controller"
                        ? controller.controller.name || "Controller"
                        : "Controller"}
                    </span>
                    {controller.targetKind === "controller" &&
                      controller.controller.url && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {controller.controller.url}
                        </span>
                      )}
                  </div>
                </div>
              )}

              <h2 className="m-0 mt-1.5 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-foreground max-md:text-[24px]">
                {stateWord}
              </h2>
              <p className="m-0 max-w-[34ch] text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                {stateNote}
              </p>
              {uptimeClock && (
                <p
                  className="m-0 mt-0.5 text-[12px] font-medium font-mono tabular-nums text-muted-foreground max-md:hidden"
                  aria-label={t("uptime", { duration: uptimeClock })}
                >
                  {uptimeClock}
                </p>
              )}

              {connectError && (
                <div className="w-full mt-2 text-left">
                  <Alert
                    variant="destructive"
                    className="rounded-control border-destructive/30 bg-destructive/5 text-destructive p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="size-2 rounded-full bg-destructive mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <AlertTitle className="text-xs font-semibold text-destructive">
                          {connectError.kind === "port_conflict"
                            ? t("portConflictTitle")
                            : connectError.kind === "tun_denied"
                              ? t("tunDeniedTitle")
                              : t("connectFailed")}
                        </AlertTitle>
                        <AlertDescription className="text-xs text-muted-foreground mt-1 flex flex-col gap-2">
                          <span>
                            {connectError.kind === "port_conflict"
                              ? t("portConflictDesc")
                              : connectError.kind === "tun_denied"
                                ? t("tunDeniedDesc")
                                : connectError.message}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {connectError.kind === "port_conflict" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-xs font-medium cursor-pointer"
                                onClick={async () => {
                                  setConnectError(null);
                                  await run(() => up({ port: 7891 }), false);
                                }}
                              >
                                {t("switchPortAndRetry")}
                              </Button>
                            )}
                            {connectError.kind === "tun_denied" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2.5 text-xs font-medium cursor-pointer"
                                  onClick={async () => {
                                    setConnectError(null);
                                    await setMode({
                                      systemProxy: true,
                                      tun: false,
                                    });
                                    await run(() => up(), false);
                                  }}
                                >
                                  {t("fallbackSysproxy")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs font-medium cursor-pointer"
                                  onClick={() => {
                                    setConnectError(null);
                                    setPrivilegeDialogOpen(true);
                                  }}
                                >
                                  {st("takeover.installService")}
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs ml-auto cursor-pointer"
                              onClick={() => setConnectError(null)}
                            >
                              {tc("cancel")}
                            </Button>
                          </div>
                        </AlertDescription>
                      </div>
                    </div>
                  </Alert>
                </div>
              )}
            </div>

            <ul className="mt-4 grid w-full list-none grid-cols-3 gap-2">
              {facts.map((fact) => (
                <li
                  key={fact.kind}
                  className={cn(
                    "bento-inset flex min-w-0 flex-col items-center gap-1.5 rounded-[14px] px-2 py-2.5 text-[11px] text-muted-foreground",
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
                        "text-[13px] font-semibold tabular-nums [overflow-wrap:anywhere]",
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

            <div className="bento-inset mt-2.5 flex w-full items-center gap-2.5 self-stretch px-3 py-2 text-[12px] text-muted-foreground max-md:hidden">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-control bg-inset text-muted-foreground"
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

          <section
            className="bento bento-interactive [grid-area:strategy] flex min-w-0 flex-col gap-3 p-4"
            aria-label={t("strategyGroups")}
          >
            {/* Header: 标题 + 策略组数量 + 全部策略跳转 */}
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
                {t("strategyGroups")}
              </h2>
              <Link
                to="/proxies"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground no-underline transition-colors hover:text-brand-text"
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

            {/* 加头之后的整体内容板块：策略组胶囊 + 出站节点，作为一组在剩余空间居中 */}
            <div className="my-auto flex flex-col gap-2.5 border-t border-border/70 pt-3">
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
                          "shrink-0 cursor-pointer rounded-control border px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 select-none max-md:min-h-11 max-md:px-3.5",
                          isCurrent
                            ? "border-brand/25 bg-brand-soft/80 font-semibold text-brand-text"
                            : "border-[var(--glass-border)] bg-white/35 text-muted-foreground hover:bg-white/60 hover:text-foreground dark:bg-white/10 dark:hover:bg-white/15",
                        )}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </ScrollablePills>
              )}

              {/* 组信息小标头：组名、类型 (Selector/URLTest/Fallback)、成员总数 */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  {available.length > 1 && group?.type ? null : (
                    <span className="font-semibold text-foreground">
                      {group ? group.name : t("strategy.title")}
                    </span>
                  )}
                  {group?.type && (
                    <span className="rounded-[4px] bg-inset px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
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
                className="bento-inset group mt-1 flex w-full cursor-pointer items-center gap-3 p-2.5 text-left text-foreground"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
              >
                {/* 节点图标头像 (40px 圆角国旗 / 直连 / 拦截 / 服务器图标) */}
                <span
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[var(--glass-border)] bg-white/40 text-muted-foreground dark:bg-white/10"
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
                    className="truncate text-[14px] font-semibold text-foreground tracking-tight"
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
                    className="grid size-7 place-items-center rounded-[9px] border border-[var(--glass-border)] bg-white/40 text-muted-foreground transition-colors group-hover:bg-brand-soft group-hover:text-brand-text dark:bg-white/10"
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
            className="bento bento-interactive [grid-area:prefs] flex min-w-0 flex-col gap-3 p-4"
            aria-label={t("prefs")}
          >
            <h2 className="text-[14px] font-semibold tracking-tight">
              {t("prefs")}
            </h2>
            {hasLocalAPI && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {t("takeoverMode")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                    <span className="size-1.5 rounded-full bg-success" />
                    <span className="font-sans text-[11px] text-muted-foreground">
                      {t("port")}
                    </span>
                    <span className="font-semibold text-foreground">
                      {mixedPort}
                    </span>
                  </span>
                </div>

                {/* System Proxy */}
                <div className="bento-inset flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-white/45 dark:hover:bg-white/10">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <strong className="text-[13px] font-semibold text-foreground">
                      {t("sysproxy")}
                    </strong>
                    <span className="text-[11px] leading-4 text-muted-foreground">
                      {st("takeover.sysproxyDesc")}
                    </span>
                  </div>
                  <Switch
                    checked={isSysproxy}
                    disabled={pending}
                    onCheckedChange={(checked: boolean) =>
                      void run(() => setMode({ systemProxy: checked }), false)
                    }
                    aria-label={t("sysproxy")}
                  />
                </div>

                {/* Virtual NIC (TUN) */}
                <div className="bento-inset flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-white/45 dark:hover:bg-white/10">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <strong className="text-[13px] font-semibold text-foreground">
                        {t("tun")}
                      </strong>
                      {hasLocalAPI && (
                        <HoverCard openDelay={150} closeDelay={200}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex size-4 cursor-pointer items-center justify-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                isServiceInstalled
                                  ? "text-muted-foreground/60 hover:text-foreground"
                                  : "text-warning-text hover:text-foreground",
                              )}
                              aria-label={
                                isServiceInstalled
                                  ? st("takeover.serviceInstalled")
                                  : st("takeover.tunPrivilegeHint")
                              }
                            >
                              <AlertCircle className="size-3.5" />
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent
                            align="start"
                            side="top"
                            className="flex flex-col gap-2.5 w-68 p-3 text-xs"
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 font-medium text-foreground">
                                <AlertCircle
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isServiceInstalled
                                      ? "text-success-text"
                                      : "text-warning-text",
                                  )}
                                />
                                <span>
                                  {isServiceInstalled
                                    ? st("takeover.serviceInstalled")
                                    : st("takeover.tunPrivilegeRequired")}
                                </span>
                              </div>
                              <p className="text-muted-foreground leading-relaxed text-[11px]">
                                {isServiceInstalled
                                  ? st("takeover.serviceInstalledDesc")
                                  : status?.capabilities?.tunReasonCode
                                    ? st(
                                        `takeover.tunUnavailable.${status.capabilities.tunReasonCode}` as const,
                                      )
                                    : st("takeover.tunPrivilegeHint")}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant={
                                isServiceInstalled ? "outline" : "default"
                              }
                              disabled={changingService}
                              className={cn(
                                "h-7 w-full text-xs font-medium cursor-pointer",
                                !isServiceInstalled &&
                                  "bg-brand-action text-brand-action-foreground hover:bg-brand-action-hover",
                              )}
                              onClick={() =>
                                isServiceInstalled
                                  ? void handleChangeService(false)
                                  : setPrivilegeDialogOpen(true)
                              }
                            >
                              {changingService
                                ? st("takeover.installingService")
                                : isServiceInstalled
                                  ? st("takeover.uninstallService")
                                  : st("takeover.installService")}
                            </Button>
                          </HoverCardContent>
                        </HoverCard>
                      )}
                    </div>
                    <span className="text-[11px] leading-4 text-muted-foreground">
                      {st("takeover.tunDesc")}
                    </span>
                  </div>
                  <Switch
                    checked={isTun}
                    disabled={pending || changingService}
                    onCheckedChange={(checked: boolean) => {
                      if (checked && !isTunCapable) {
                        setPrivilegeDialogOpen(true);
                        return;
                      }
                      void run(() => setMode({ tun: checked }), false);
                    }}
                    aria-label={t("tun")}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <span className="text-[11px] font-semibold text-muted-foreground">
                {tc("routingMode.title")}
              </span>
              <SegmentedControl
                ariaLabel={tc("routingMode.title")}
                options={routingOptions}
                value={routingValue ?? null}
                disabled={pending}
                className="grid w-full grid-cols-3"
                itemClassName="px-2 whitespace-normal"
                onChange={(mode) => void switchRouting(mode)}
              />
              {currentMode === "rule" ||
              currentMode === "global" ||
              currentMode === "direct" ? (
                <p className="m-0 text-[11px] leading-4 text-muted-foreground">
                  {t(`routingHint.${currentMode}`)}
                </p>
              ) : null}
            </div>
          </section>

          <section
            className={cn(
              cardSurface,
              // 自建命名容器：兩欄佈局下此卡只有 ~440px 寬，內層「速率｜圖表｜
              // 配額」三列排布按卡寬切換，不再依賴整頁容器（否則圖表被右側
              // min-w 配額擠成幾十像素，軸標籤與空態文案豎排折行）。
              "@container/live [grid-area:live] flex min-h-[180px] flex-col gap-3 p-4 max-md:min-h-0",
            )}
            aria-label={t("trafficStats")}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold text-foreground">
                {t("trafficStats")}
              </h2>
            </div>

            <div className="bento-inset grid min-w-0 grid-cols-1 items-stretch gap-3 rounded-[16px] p-3 @min-[36rem]/live:grid-cols-[auto_minmax(0,1fr)_auto] @min-[36rem]/live:gap-6">
              {/* Desktop Speeds: 左右横排，橙色箭头，中间发丝分割线 */}
              <div className="my-auto hidden items-center gap-6 pe-2 @min-[36rem]/live:flex">
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
                  <b className="whitespace-nowrap text-[22px] font-semibold text-foreground tabular-nums tracking-[-0.02em]">
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
                      className="text-muted-foreground shrink-0"
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
                  <b className="whitespace-nowrap text-[22px] font-semibold text-foreground tabular-nums tracking-[-0.02em]">
                    {trafficState === "open" && speed
                      ? formatDisplayRate(speed.up)
                      : "—"}
                  </b>
                </div>
              </div>

              {/* Mobile Speeds */}
              <div className="flex items-center justify-between gap-4 @min-[36rem]/live:hidden">
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
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-inset text-muted-foreground"
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
              <div className="hidden min-w-0 flex-wrap items-start justify-between gap-3.5 border-t border-border/80 pt-3 md:flex @min-[36rem]/live:min-w-[190px] @min-[36rem]/live:flex-col @min-[36rem]/live:justify-center @min-[36rem]/live:border-s @min-[36rem]/live:border-t-0 @min-[36rem]/live:pe-1 @min-[36rem]/live:ps-6 @min-[36rem]/live:pt-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("sessionTotal")}
                  </span>
                  <b className="whitespace-nowrap text-[20px] font-semibold text-foreground tabular-nums tracking-[-0.02em]">
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
      )}

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

      <AlertDialog
        open={privilegeDialogOpen}
        onOpenChange={setPrivilegeDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {st("takeover.privilegeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {st("takeover.privilegeDialogDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPrivilegeDialogOpen(false);
                void handleChangeService(true);
              }}
            >
              {st("takeover.installService")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
