import { formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import { focusedGroup, strategyPath } from "@xbond/client/workspace";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsRight,
  Globe,
  Layers,
  Monitor,
  Network,
  Power,
  Route,
  Shield,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AuroraWave } from "@/components/aurora-wave";
import { CountryFlag } from "@/components/country-flag";
import { nodeFlagCode, stripFlagEmoji } from "@/components/country-flag";
import { DisconnectedState } from "@/components/disconnected-state";
import { SegmentedControl } from "@/components/segmented-control";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
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

type TrafficWindow = "live" | "m1" | "m5" | "m30";

const WINDOW_SPANS_MS: Record<Exclude<TrafficWindow, "live">, number> = {
  m1: 60_000,
  m5: 300_000,
  m30: 1_800_000,
};

/** 30 分鐘 @ 1Hz 的本機環形緩衝；聚合視窗從中按時間過濾後分桶平均。 */
const HISTORY_LIMIT = 1_800;
const WINDOW_BUCKETS = 120;

function aggregateWindow(
  history: TrafficSample[],
  spanMs: number,
): TrafficSample[] {
  const cutoff = Date.now() - spanMs;
  const recent = history.filter((sample) => sample.at >= cutoff);
  if (recent.length <= 1) return recent;
  const bucketMs = spanMs / WINDOW_BUCKETS;
  const buckets = new Map<
    number,
    { up: number; down: number; count: number }
  >();
  for (const sample of recent) {
    const key = Math.floor(sample.at / bucketMs);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.up += sample.up;
      bucket.down += sample.down;
      bucket.count += 1;
    } else {
      buckets.set(key, { up: sample.up, down: sample.down, count: 1 });
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, bucket]) => ({
      at: key * bucketMs,
      up: bucket.up / bucket.count,
      down: bucket.down / bucket.count,
    }));
}

/**
 * 三層事實行的專屬圖標：核心（雷達靶心）、接管（閃電）與出口（護盾勾選），與設計稿一致。
 */
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
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    );
  }
  if (kind === "takeover") {
    return (
      <svg {...common}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
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
  const connectButtonRef = useRef<HTMLButtonElement>(null);
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
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("live");

  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      setSpeed(items.at(-1) ?? null);
      const latest = items.at(-1);
      if (latest) {
        const at = Date.now();
        setHistory((previous) =>
          [...previous, { ...latest, at }].slice(-HISTORY_LIMIT),
        );
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

  // 視窗取樣：實時用原始樣本，其餘視窗按時間過濾後分桶平均。
  // 開流時樣本每秒到達，memo 會持續推進；斷流時保持最後快照。
  const windowedSamples = useMemo<TrafficSample[]>(() => {
    if (trafficState !== "open" || history.length === 0) return [];
    if (trafficWindow === "live") return history.slice(-60);
    return aggregateWindow(history, WINDOW_SPANS_MS[trafficWindow]);
  }, [history, trafficState, trafficWindow]);

  const running = hasLocalAPI && (status?.engine.running ?? false);
  const sub = hasLocalAPI ? (status?.activeSub ?? null) : null;
  const quota = subscriptionQuota(sub);
  const coreOpen = trafficState === "open" || Boolean(general.mode);
  const active = hasLocalAPI ? running : !isLocalTarget && coreOpen;
  const remote =
    controller.targetKind === "controller" ? controller.controller : null;
  const remoteName =
    remote &&
    remote.name !== remote.url &&
    remote.name !== new URL(remote.url).host
      ? remote.name
      : "";
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
  const egress = hasLocalAPI ? status?.threeTier : undefined;

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

  const uptimeClock = running
    ? formatUptimeClock(status?.engine.uptimeSeconds)
    : null;
  const sessionTotal =
    connectionState === "open" && snapshot
      ? snapshot.downloadTotal + snapshot.uploadTotal
      : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;

  const configName = hasLocalAPI
    ? (sub?.name ?? t("noConfigTitle"))
    : remote
      ? remoteName || remote.url
      : controller.hostname || t("currentConfig");
  // 問候語是裝飾：掛載時取一次時段即可，不在每次渲染重算（純渲染約束）。
  const [greeting] = useState(() => {
    const hour = new Date().getHours();
    return hour < 12
      ? t("greeting.morning")
      : hour < 18
        ? t("greeting.afternoon")
        : t("greeting.evening");
  });
  const trafficWindowOptions: { value: TrafficWindow; label: string }[] = [
    { value: "live", label: t("window.live") },
    { value: "m1", label: t("window.m1") },
    { value: "m5", label: t("window.m5") },
    { value: "m30", label: t("window.m30") },
  ];
  const stateWord = hasLocalAPI
    ? running
      ? t("connected")
      : t("stopped")
    : trafficState === "open"
      ? t("coreReachable")
      : r(trafficState);
  const connectionAction = running ? t("disconnect") : t("connect");
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

  const coreReachable = hasLocalAPI
    ? egress?.coreReachable === true
    : trafficState === "open";
  const facts = [
    {
      kind: "core" as const,
      tone: coreReachable ? "ok" : "muted",
      showDot: coreReachable,
      label: t("tiers.core"),
      value: hasLocalAPI
        ? coreReachable
          ? r("open")
          : !status
            ? tc("unknown")
            : running
              ? egress
                ? r("closed")
                : tc("unknown")
              : t("stopped")
        : r(trafficState),
    },
    {
      kind: "takeover" as const,
      tone: hasLocalAPI ? (isSysproxy || isTun ? "ok" : "muted") : "unknown",
      showDot: false,
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
      tone: egress?.egressVerified ? "ok" : "unknown",
      showDot: Boolean(egress?.egressVerified && egress.egressLatencyMs <= 0),
      label: t("tiers.egress"),
      value: egress?.egressVerified
        ? egress.egressLatencyMs > 0
          ? `${egress.egressLatencyMs} ms`
          : t("egressVerified")
        : tc("unknown"),
    },
  ];

  function setFocusGroup(name: string) {
    setFocus((previous) => ({ ...previous, [focusKey]: name }));
  }

  // 分段項帶圖標（設計稿形態）：上圖標、下文字的雙行膠囊塊（規則=滑桿、全局=地球、直連=雙箭頭）。
  const routingIcons = {
    rule: <SlidersHorizontal aria-hidden="true" className="size-4" />,
    global: <Globe aria-hidden="true" className="size-4" />,
    direct: <ChevronsRight aria-hidden="true" className="size-4" />,
  } as const;
  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: (
        <span className="inline-flex flex-col items-center justify-center gap-1 py-0.5 leading-tight">
          {routingIcons[mode]}
          <span>{tc(`routingMode.${mode}`)}</span>
        </span>
      ),
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
    <div className="page home-page">
      {localConfig && !status && (
        <div
          className="bento flex items-center justify-between gap-3 p-4 text-sm"
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

      {hasLocalAPI && !sub && !running ? (
        <OnboardingGuide className="my-auto py-6" />
      ) : isLocalTarget && !hasLocalAPI ? (
        // 本機 daemon 離線：保留本機身份與重試入口，不顯示遠端控制器視圖。
        <DisconnectedState className="my-auto py-6" />
      ) : !hasDaemonConfig() && !active ? (
        <ExternalControllerOnboarding className="my-auto py-6" />
      ) : (
        <div className="relative mx-auto flex w-full min-w-0 flex-1 flex-col gap-3 xl:gap-4">
          <AuroraWave className="home-wave -top-4 -end-[var(--page-pad)] h-64 w-[62%] opacity-80 xl:-top-8 xl:h-80" />
          {/* 開放式 Hero：狀態直接落在畫布上，品牌波形裝飾在右後方。 */}
          <section
            className="relative z-20 flex min-w-0 shrink-0 flex-col justify-center gap-3 px-1 pb-1 lg:px-2 2xl:pb-10"
            aria-label={t("connect")}
          >
            <div className="relative flex min-w-0 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p
                  aria-hidden="true"
                  className="home-greeting text-body font-medium text-muted-foreground"
                >
                  {greeting}
                </p>
                <h1
                  className="flex flex-wrap items-center gap-x-3 text-headline leading-tight font-bold tracking-tight text-foreground 2xl:text-display"
                  aria-live="polite"
                >
                  {remote && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        trafficState === "open"
                          ? "bg-success"
                          : "bg-muted-foreground/55",
                      )}
                    />
                  )}
                  {stateWord}
                  {uptimeClock && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-sm font-semibold tabular-nums tracking-normal text-success-text"
                      aria-label={t("uptime", { duration: uptimeClock })}
                    >
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-success"
                      />
                      {uptimeClock}
                    </span>
                  )}
                </h1>
                {remote && (
                  <div className="flex w-full min-w-0 flex-wrap gap-x-2 text-label">
                    {remoteName && (
                      <span
                        className="max-w-full truncate font-medium text-foreground"
                        title={remoteName}
                      >
                        {remoteName}
                      </span>
                    )}
                    <span
                      className="max-w-full truncate font-mono text-muted-foreground"
                      title={remote.url}
                    >
                      {remote.url}
                    </span>
                  </div>
                )}
                <p className="max-w-[52ch] text-sm text-muted-foreground xl:text-body">
                  {stateNote}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-0.5">
                {hasLocalAPI ? (
                  <Button
                    type="button"
                    ref={connectButtonRef}
                    variant="brand"
                    className="h-10 w-full gap-2 px-5 text-sm font-semibold max-md:min-h-11 sm:w-auto xl:h-12 xl:min-w-40 xl:text-body"
                    disabled={pending || (!running && !sub)}
                    aria-busy={pending}
                    onClick={() => void handleToggleConnection()}
                  >
                    {pending ? (
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 animate-[native-spin_0.8s_linear_infinite] rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                      />
                    ) : (
                      <Power aria-hidden="true" className="size-4" />
                    )}
                    {connectionAction}
                  </Button>
                ) : (
                  remote && (
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center rounded-full border border-brand/20 bg-brand-soft/65 text-brand-text"
                    >
                      <Monitor className="size-5" strokeWidth={1.7} />
                    </span>
                  )
                )}
              </div>
            </div>
          </section>

          {/* 狀態條：配置身份與三層事實一行講完，管理入口固定右側。 */}
          <section
            className="bento relative z-10 flex min-w-0 shrink-0 flex-col gap-3 p-4 lg:flex-row lg:items-center lg:py-2.5 xl:gap-4 xl:p-5"
            aria-label={t("currentConfig")}
          >
            <div className="flex min-w-0 items-center gap-2.5 lg:w-36 lg:shrink-0 xl:w-52">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-brand/15 bg-brand-soft/85 text-brand shadow-2xs"
              >
                {remote ? (
                  <Monitor className="size-5" strokeWidth={1.75} />
                ) : (
                  <Layers className="size-5" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className="block truncate text-[15px] font-bold tracking-tight text-foreground"
                  title={configName}
                >
                  {configName}
                </span>
                {remote && (
                  <span
                    className="block truncate font-mono text-label text-muted-foreground"
                    title={remote.url}
                  >
                    {remote.url}
                  </span>
                )}
              </span>
            </div>
            <ul
              className={cn(
                "grid min-w-0 flex-1 list-none",
                remote
                  ? "grid-cols-2 divide-x divide-border"
                  : "grid-cols-1 gap-2 divide-y divide-border lg:grid-cols-3 lg:gap-y-0 lg:divide-x lg:divide-y-0",
              )}
            >
              {facts
                .filter((fact) => !remote || fact.kind !== "core")
                .map((fact) => (
                  <li
                    key={fact.kind}
                    className="flex min-w-0 flex-col gap-0.5 px-2 text-xs first:ps-0 last:pe-0 lg:items-start xl:px-4 xl:text-sm"
                  >
                    <span className="flex items-center gap-1.5 text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
                      <FactIcon kind={fact.kind} />
                      {fact.label}
                    </span>
                    <b
                      className={cn(
                        "flex items-center gap-1.5 text-sm font-semibold tabular-nums [overflow-wrap:anywhere] xl:ps-5",
                        fact.tone === "brand"
                          ? "text-brand-text"
                          : fact.tone === "ok"
                            ? "text-success-text"
                            : fact.tone === "unknown"
                              ? "text-muted-foreground"
                              : "text-foreground",
                      )}
                    >
                      {fact.showDot && (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-success"
                        />
                      )}
                      {fact.value}
                    </b>
                  </li>
                ))}
            </ul>
            {remote ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full max-lg:self-start"
                onClick={() => setIdentity(false)}
              >
                {t("manageController")}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 rtl:rotate-180"
                />
              </Button>
            ) : (
              <Link
                to="/config"
                className="inline-flex h-8.5 shrink-0 items-center gap-1 self-start rounded-full border border-brand/15 bg-brand-soft/85 px-3 text-sm font-semibold text-brand-text xl:px-4 transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:min-h-11 lg:self-center"
              >
                {t("manage")}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 rtl:rotate-180"
                />
              </Link>
            )}
          </section>

          <div className="relative z-10 grid grid-cols-1 gap-3 lg:flex-1 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] xl:gap-4">
            <section
              className="bento flex min-w-0 flex-col gap-2.5 p-3 xl:gap-4 xl:p-5"
              aria-label={t("trafficStats")}
            >
              {/* 卡头右侧同欄放時間窗控件 */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="text-lg font-bold text-foreground xl:text-title">
                  {t("trafficStats")}
                </h2>
                <SegmentedControl
                  ariaLabel={t("trafficHistory")}
                  options={trafficWindowOptions}
                  value={trafficWindow}
                  onChange={setTrafficWindow}
                  disabled={trafficState !== "open"}
                  className="min-h-7 p-0.5"
                  itemClassName="px-2 py-1 text-xs xl:px-2.5 xl:text-sm"
                />
              </div>
              <dl className="grid grid-cols-2 divide-x divide-border">
                {(
                  [
                    {
                      direction: "download",
                      rate: speed?.down,
                      Icon: ArrowDown,
                    },
                    { direction: "upload", rate: speed?.up, Icon: ArrowUp },
                  ] as const
                ).map(({ direction, rate, Icon }) => (
                  <div
                    key={direction}
                    className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 px-3 first:ps-0 last:pe-0"
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "row-span-2 size-4.5",
                        direction === "download" ? "text-brand" : "text-upload",
                      )}
                    />
                    <dt className="col-start-2 text-label text-muted-foreground">
                      {t(direction)}
                    </dt>
                    <dd className="col-start-2 text-title leading-tight font-bold tracking-tight tabular-nums text-foreground xl:text-metric">
                      {trafficState === "open" && rate !== undefined
                        ? formatDisplayRate(rate)
                        : "—"}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* 曲線直接落在流量卡面，不套二層邊框，保持畫面通透 */}
              <div className="flex min-w-0 flex-1 px-0.5 py-1">
                <TrafficChart
                  samples={windowedSamples}
                  title={t("trafficHistory")}
                  empty={t("collectingSamples")}
                  stale={trafficState !== "open"}
                  staleLabel={t("streamStopped")}
                />
              </div>

              {/* 累計與配額收進內凹雙格：剩餘配額數字與進度條同行橫排（設計稿形態） */}
              <dl className="bento-inset grid grid-cols-2 divide-x divide-border px-2.5 py-1.5 xl:px-3.5 xl:py-2">
                <div className="flex min-w-0 items-center gap-2.5 pe-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-card/85 text-muted-foreground shadow-2xs"
                  >
                    <Layers className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t("sessionTotal")}
                    </dt>
                    <dd className="truncate text-sm font-bold tabular-nums text-foreground">
                      {sessionTotal !== null
                        ? formatDisplayTraffic(sessionTotal)
                        : "—"}
                    </dd>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2.5 ps-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-card/85 text-muted-foreground shadow-2xs"
                  >
                    <Wallet className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <dt className="text-xs text-muted-foreground">
                      {t("quota.remaining")}
                    </dt>
                    <dd className="min-w-0">
                      {sub && quota ? (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <b className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                            {formatDisplayTraffic(quota.remaining)}{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              / {formatDisplayTraffic(sub.total)}
                            </span>
                          </b>
                          <span
                            className="block h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
                            role="meter"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(quotaPercent ?? 0)}
                            aria-label={t("quota.remaining")}
                          >
                            <span
                              className="block h-full origin-left rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
                              style={{
                                width: `${Math.round(quotaPercent ?? 0)}%`,
                              }}
                            />
                          </span>
                        </div>
                      ) : (
                        <span className="block truncate text-sm font-medium tabular-nums text-muted-foreground">
                          {sub
                            ? t("quota.unknown")
                            : hasLocalAPI
                              ? t("noConfig")
                              : t("quotaUnavailable")}
                        </span>
                      )}
                    </dd>
                  </div>
                </div>
              </dl>
            </section>

            <section
              className="bento flex min-w-0 flex-col gap-3 p-3 xl:gap-4 xl:p-5"
              aria-label={t("strategyGroups")}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="text-lg font-bold text-foreground xl:text-title">
                  {t("strategyGroups")}
                </h2>
                <Link
                  to="/proxies"
                  className="inline-flex min-h-7 items-center gap-0.5 text-label font-medium text-muted-foreground hover:text-brand-text hover:underline hover:underline-offset-4 max-md:min-h-11"
                >
                  {t("allStrategies")}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 rtl:rotate-180"
                  />
                </Link>
              </div>

              {group && (
                <div className="flex flex-col gap-1">
                  {available.length > 1 ? (
                    <>
                      <label htmlFor="home-policy-group" className="sr-only">
                        {t("chooseGroup")}
                      </label>
                      <NativeSelect
                        id="home-policy-group"
                        size="sm"
                        wrapperClassName="w-full"
                        className="truncate bg-inset font-semibold max-md:min-h-11"
                        value={group.name}
                        title={group.name}
                        onChange={(event) => setFocusGroup(event.target.value)}
                      >
                        {available.map((item) => (
                          <NativeSelectOption key={item.name} value={item.name}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </>
                  ) : (
                    <>
                      <span className="sr-only">{t("chooseGroup")}</span>
                      <p
                        className="truncate text-body font-semibold text-foreground"
                        title={group.name}
                      >
                        {group.name}
                      </p>
                    </>
                  )}
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 px-0.5 text-label text-muted-foreground">
                    <span className="[overflow-wrap:anywhere]">
                      {group.type}
                    </span>
                    {group.all && (
                      <span className="tabular-nums">
                        · {group.all.length} {t("strategyMembers")}
                      </span>
                    )}
                  </p>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <button
                  type="button"
                  className="bento-inset group flex w-full cursor-pointer items-center gap-3 bg-card/85 px-3 py-2 text-start text-foreground shadow-2xs transition-colors hover:border-brand/35 hover:bg-brand-soft/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                  onClick={() => setPickerOpen(true)}
                  aria-haspopup="dialog"
                >
                  {/* 节点图标头像 (44px 圆角国旗 / 直连 / 拦截 / 服务器图标) */}
                  <span
                    className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-card shadow-2xs"
                    aria-hidden="true"
                  >
                    {isDirect ? (
                      <svg
                        viewBox="0 0 24 24"
                        width="22"
                        height="22"
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
                        width="22"
                        height="22"
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
                      <CountryFlag
                        code={leafFlag}
                        avatar
                        className="size-full"
                      />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        width="22"
                        height="22"
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

                  {/* 节点名称与延迟分列：左侧身份，右侧测量读数 */}
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-x-2">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("currentNode")}
                      </span>
                      <span
                        className="truncate text-body font-bold tracking-tight text-foreground"
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
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums">
                      {leafDelay ? (
                        <>
                          <b
                            className={cn(
                              "font-mono text-sm font-bold tabular-nums",
                              latencyClass(leafDelay),
                            )}
                          >
                            {leafDelay} ms
                          </b>
                          <span className="text-muted-foreground">
                            {t("lastMeasured")}
                          </span>
                        </>
                      ) : leafNodeName ? (
                        <span className="text-muted-foreground">
                          {px("untested")}
                        </span>
                      ) : null}
                    </span>
                  </span>

                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand-text rtl:rotate-180"
                  />
                </button>
                {chain.length >= 2 && (
                  <p className="flex min-w-0 items-center gap-1.5 px-1 text-label text-muted-foreground">
                    <Route
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-brand"
                    />
                    <span className="sr-only">{t("routingChain")}</span>
                    <span className="truncate" title={chain.join(" → ")}>
                      {chain.join(" → ")}
                    </span>
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* 第四行：連接偏好與流量接管對半雙欄；
              遠端控制器沒有本機接管卡，偏好卡跨全寬。 */}
          <div
            className={cn(
              "relative z-10 grid shrink-0 grid-cols-1 gap-3 xl:gap-4",
              hasLocalAPI
                ? "lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
                : "lg:grid-cols-1",
            )}
          >
            <section
              className="bento flex min-w-0 flex-col justify-between gap-2 p-3 lg:flex-row lg:items-center xl:gap-3 xl:p-4"
              aria-label={t("prefs")}
            >
              {/* 左欄身份：圖示 + 標題 + 描述，右欄留給路由模式上圖下字分段塊。 */}
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-inset text-muted-foreground"
                >
                  <SlidersHorizontal className="size-4.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground">
                    {t("prefs")}
                  </h2>
                  <p className="home-preference-note text-xs text-muted-foreground">
                    {t("prefsDesc")}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 shrink-0 flex-col gap-1.5">
                <span className="text-label font-medium text-muted-foreground lg:hidden">
                  {tc("routingMode.title")}
                </span>
                <SegmentedControl
                  ariaLabel={tc("routingMode.title")}
                  options={routingOptions}
                  value={routingValue ?? null}
                  disabled={pending}
                  className="grid w-full grid-cols-3 p-1 lg:w-auto"
                  itemClassName="px-2.5 py-1 text-xs xl:py-1.5 xl:text-sm"
                  onChange={(mode) => void switchRouting(mode)}
                />
              </div>
            </section>

            {hasLocalAPI && (
              <section
                className="bento flex min-w-0 flex-col justify-between gap-2 p-3 xl:flex-row xl:items-center xl:gap-3 xl:p-4"
                aria-label={t("takeoverMode")}
              >
                {/* 左欄身份：圖示 + 標題 + 端口讀數 */}
                <div className="flex min-w-0 items-center gap-2.5 xl:shrink-0">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-inset text-muted-foreground"
                  >
                    <Layers className="size-4.5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("takeoverMode")}
                    </h2>
                    <p className="text-xs whitespace-nowrap text-muted-foreground">
                      {t("port")}{" "}
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {mixedPort}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:items-center sm:divide-x sm:divide-y-0 xl:flex-1 xl:border-s xl:border-border xl:ps-3">
                  {/* System Proxy */}
                  <div className="flex min-w-0 items-center justify-between gap-2 py-2 sm:pe-2.5 sm:py-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Network
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <strong className="text-sm leading-tight font-semibold text-foreground">
                          {t("sysproxy")}
                        </strong>
                        <span className="text-xs leading-4 text-muted-foreground lg:hidden">
                          {st("takeover.sysproxyDesc")}
                        </span>
                      </div>
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
                  <div className="flex min-w-0 items-center justify-between gap-2 py-2 sm:ps-2.5 sm:py-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Shield
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <strong className="text-sm leading-tight font-semibold text-foreground">
                            {t("tun")}
                          </strong>
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
                                <p className="text-muted-foreground leading-relaxed text-xs">
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
                        </div>
                        <span className="text-xs leading-4 text-muted-foreground lg:hidden">
                          {st("takeover.tunDesc")}
                        </span>
                      </div>
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
              </section>
            )}
          </div>
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
        open={connectError !== null}
        onOpenChange={(open) => {
          if (!open) setConnectError(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!privilegeDialogOpen) connectButtonRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {connectError?.kind === "port_conflict"
                ? t("portConflictTitle")
                : connectError?.kind === "tun_denied"
                  ? t("tunDeniedTitle")
                  : t("connectFailed")}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {connectError?.kind === "port_conflict"
                ? t("portConflictDesc")
                : connectError?.kind === "tun_denied"
                  ? t("tunDeniedDesc")
                  : connectError?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap">
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            {connectError?.kind === "port_conflict" && (
              <AlertDialogAction
                onClick={() => void run(() => up({ port: 7891 }), false)}
              >
                {t("switchPortAndRetry")}
              </AlertDialogAction>
            )}
            {connectError?.kind === "tun_denied" && (
              <>
                <AlertDialogAction
                  variant="outline"
                  onClick={() => setPrivilegeDialogOpen(true)}
                >
                  {st("takeover.installService")}
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={async () => {
                    await setMode({ systemProxy: true, tun: false });
                    await run(() => up(), false);
                  }}
                >
                  {t("fallbackSysproxy")}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
