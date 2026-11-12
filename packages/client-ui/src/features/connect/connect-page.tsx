import { formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import {
  focusedGroup,
  strategyPath,
  workspaceLink,
} from "@xbond/client/workspace";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  AlertCircle,
  ArrowUpDown,
  ChevronRight,
  ChevronsRight,
  Gauge,
  Globe,
  Layers,
  Monitor,
  Network,
  Power,
  Shield,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
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
import { useIsMobile } from "@/platform/host";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import { useAPIInfo, useClient, identityAtom } from "@/state/controller-target";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

import { classifyConnectError, type ConnectError } from "./connect-error";
import { ExternalControllerOnboarding } from "./external-controller-onboarding";
import { NodePicker } from "./node-picker";
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
 * 狀態列圖標。
 */
function FactIcon({ kind }: { kind: "core" | "takeover" | "connections" }) {
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
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v5M5 17v-2a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2" />
    </svg>
  );
}

function UptimeClock({ uptimeSeconds }: { uptimeSeconds: number | undefined }) {
  const { t } = useTranslation("connect");
  const [seconds, setSeconds] = useState(uptimeSeconds);

  useEffect(() => {
    if (uptimeSeconds === undefined || !Number.isFinite(uptimeSeconds)) return;

    const receivedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(uptimeSeconds + Math.floor((Date.now() - receivedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [uptimeSeconds]);

  const clock = formatUptimeClock(seconds);
  if (!clock) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-sm font-semibold tabular-nums tracking-normal text-success-text"
      aria-label={t("uptime", { duration: clock })}
      aria-live="off"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      {clock}
    </span>
  );
}

export default function Connect() {
  const { t } = useTranslation("connect");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const { t: st } = useTranslation("settings");
  const isMobile = useIsMobile();
  const controller = useAPIInfo();
  const location = useLocation();
  const client = useClient();
  const { general, update } = useGeneral();
  const nodeSelection = useNodeSelection();
  const {
    groups,
    global,
    isLoading: proxiesLoading,
    update: updateProxies,
  } = useProxy();
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
  const [connectError, setConnectError] = useState<ConnectError | null>(null);
  // 授权弹窗返回后的一次性自动重试（见 connectUp）。
  const consentRetryRef = useRef<(() => void) | null>(null);

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

  // Android 授权弹窗关闭、App 回到前景时直接续连一次，不用再手动按连接。
  // 只重试一次：再次失败（弹窗被取消或拒绝）就停在带「重试」的错误框上。
  function disarmConsentRetry() {
    const retry = consentRetryRef.current;
    if (retry) {
      window.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
      consentRetryRef.current = null;
    }
  }

  function connectUp() {
    disarmConsentRetry();
    setConnectError(null);
    void (async () => {
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
        const error = classifyConnectError(resMsg);
        setConnectError(error);
        if (error.kind === "vpn_consent") {
          const retry = () => {
            // 授权弹窗盖上时 webview 先转隐藏：只在真正回到前景时重试。
            if (document.visibilityState !== "visible") return;
            disarmConsentRetry();
            connectUp();
          };
          consentRetryRef.current = retry;
          window.addEventListener("visibilitychange", retry);
          window.addEventListener("focus", retry);
        }
      }
    })();
  }

  const handleToggleConnection = () => {
    if (running) {
      disarmConsentRetry();
      setConnectError(null);
      void run(() => down(), false);
    } else {
      connectUp();
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
  const [snapshot, setSnapshot] = useState<{
    stream: typeof connections;
    data: Snapshot;
  } | null>(null);
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
    const onData = (items: Snapshot[]) => {
      const data = items.at(-1);
      setSnapshot(data ? { stream: connections, data } : null);
    };
    const unsubscribeState = connections.subscribeState((state) => {
      if (state !== "open") setSnapshot(null);
    });
    connections.subscribe("data", onData);
    return () => {
      unsubscribeState();
      connections.unsubscribe("data", onData);
    };
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

  // 首頁掛載時核心尚未運行，/proxies 首拉必然失敗且 SWR 不會自行重試；
  // 連接成功後補拉，直到節點鏈落到真實葉子——首個快照不僅可能整體缺失，
  // URLTest 的首次健康檢查也要一兩分鐘才給出 now，鏈會停在半途的策略組。
  // 5s×60 上限（約 5 分鐘）兜底，落定即停。
  const hasProxyData = groups.length > 0 || global.all.length > 0;
  const proxyChainSettled =
    chain.length > 0 &&
    !("all" in (mapping.get(chain[chain.length - 1]) ?? {}));
  useEffect(() => {
    if (!running || (hasProxyData && proxyChainSettled)) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > 60) {
        window.clearInterval(timer);
        return;
      }
      void updateProxies();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [running, hasProxyData, proxyChainSettled, updateProxies]);
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

  // 組內成員延遲分布（與代理頁同一份 history）：首頁可掃讀的組健康度摘要，
  // 也讓策略卡的內容量與左側流量卡對稱。閾值與延遲藥丸同一套紅綠燈。
  const delayStats = group
    ? group.all.reduce(
        (acc, name) => {
          const delay = nodeDelay(name);
          if (delay === null) acc.untested += 1;
          else if (delay < 150) acc.good += 1;
          else if (delay <= 400) acc.medium += 1;
          else acc.slow += 1;
          return acc;
        },
        { good: 0, medium: 0, slow: 0, untested: 0 },
      )
    : null;

  const strategyTypeLabel = (type?: string) => {
    switch (type?.toLowerCase()) {
      case "selector":
        return t("strategy.selector");
      case "urltest":
        return t("strategy.urlTest");
      case "fallback":
        return t("strategy.fallback");
      case "loadbalance":
        return t("strategy.loadBalance");
      default:
        return type ?? "—";
    }
  };

  const currentSnapshot =
    connectionState === "open" && snapshot?.stream === connections
      ? snapshot.data
      : null;
  const sessionTotal = currentSnapshot
    ? currentSnapshot.downloadTotal + currentSnapshot.uploadTotal
    : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;

  const configName = hasLocalAPI
    ? (sub?.name ?? t("noConfigTitle"))
    : remote
      ? remoteName || remote.url
      : controller.hostname || t("currentConfig");
  const trafficWindowOptions: { value: TrafficWindow; label: string }[] = [
    { value: "live", label: t("window.live") },
    { value: "m1", label: t("window.m1") },
    { value: "m5", label: t("window.m5") },
    { value: "m30", label: t("window.m30") },
  ];
  // pending 期交代進行中的方向（連接中／斷開中）：H1 帶 aria-live，讀屏
  // 依賴這個詞；只展示已確認狀態會讓 4-5s 的轉換窗口只有按鈕轉圈一個信號。
  const stateWord = hasLocalAPI
    ? pending
      ? running
        ? t("disconnecting")
        : t("connecting")
      : running
        ? t("connected")
        : t("stopped")
    : trafficState === "open"
      ? t("coreReachable")
      : r(trafficState);
  const connectionAction = running ? t("disconnect") : t("connect");
  // 運行時的副行交代接管方式；未運行交代下一步。遠端形態不渲染此行
  // （管理歸屬已由身份行與事實線交代）。
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
    : "";

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
      kind: "connections" as const,
      tone: Array.isArray(currentSnapshot?.connections) ? "muted" : "unknown",
      showDot: false,
      label: t("activeConnections"),
      value: Array.isArray(currentSnapshot?.connections)
        ? currentSnapshot.connections.length.toLocaleString()
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
        <OnboardingGuide className="my-auto animate-in fade-in-50 slide-in-from-bottom-2 py-6 duration-300" />
      ) : isLocalTarget && !hasLocalAPI ? (
        // 本機 daemon 離線：保留本機身份與重試入口，不顯示遠端控制器視圖。
        <DisconnectedState className="my-auto animate-in fade-in-50 slide-in-from-bottom-2 py-6 duration-300" />
      ) : !hasDaemonConfig() && !active ? (
        <ExternalControllerOnboarding className="my-auto animate-in fade-in-50 slide-in-from-bottom-2 py-6 duration-300" />
      ) : (
        <div className="relative mx-auto flex w-full min-w-0 flex-1 flex-col gap-3 xl:gap-4">
          <AuroraWave className="home-wave -top-4 -end-[var(--page-pad)] h-64 w-[62%] opacity-80 xl:-top-8 xl:h-80" />
          {/* 開放式 Hero：狀態直接落在畫布上，品牌波形裝飾在右後方。 */}
          <section
            className="relative z-20 flex min-w-0 shrink-0 flex-col justify-center gap-3 px-1 pb-1 lg:px-2 2xl:pb-6"
            aria-label={t("connect")}
          >
            {isMobile ? (
              <div className="relative flex min-w-0 flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  {/* 移動端配置藥丸：取代底部/二級卡片重複資訊 */}
                  <Link
                    to="/config"
                    className="inline-flex max-w-[190px] max-md:min-h-11 items-center gap-1.5 rounded-full border border-border/80 bg-card px-2.5 max-md:px-3.5 py-1 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-inset active:scale-95"
                  >
                    {remote ? (
                      <Monitor
                        className="size-3.5 text-brand shrink-0"
                        strokeWidth={2}
                      />
                    ) : (
                      <Layers
                        className="size-3.5 text-brand shrink-0"
                        strokeWidth={2}
                      />
                    )}
                    <span className="truncate">{configName}</span>
                    <ChevronRight className="size-3 text-muted-foreground shrink-0 rtl:rotate-180" />
                  </Link>
                </div>

                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="flex flex-wrap items-center gap-x-2.5 text-headline leading-tight font-bold tracking-tight text-foreground">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2.5 shrink-0 rounded-full transition-colors duration-300",
                        running || trafficState === "open"
                          ? "bg-success"
                          : "bg-muted-foreground/55",
                      )}
                    />
                    <span aria-live="polite">{stateWord}</span>
                    {running && (
                      <UptimeClock
                        key={`${status?.engine.startedAt}:${status?.engine.uptimeSeconds}`}
                        uptimeSeconds={status?.engine.uptimeSeconds}
                      />
                    )}
                  </h1>

                  {hasLocalAPI && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {stateNote}
                      {currentSnapshot?.connections && (
                        <span className="font-mono">
                          {" "}
                          · {currentSnapshot.connections.length}{" "}
                          {t("activeConnections")}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {hasLocalAPI && (
                  <div className="flex w-full pt-1">
                    <Button
                      type="button"
                      ref={connectButtonRef}
                      variant="brand"
                      className="h-11 w-full gap-2 px-5 text-sm font-semibold rounded-xl"
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
                  </div>
                )}
              </div>
            ) : (
              <div className="relative flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="flex flex-wrap items-center gap-x-3 text-headline leading-tight font-bold tracking-tight text-foreground 2xl:text-display">
                    {remote && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 shrink-0 rounded-full transition-colors duration-300",
                          trafficState === "open"
                            ? "bg-success"
                            : "bg-muted-foreground/55",
                        )}
                      />
                    )}
                    <span aria-live="polite">{stateWord}</span>
                    {running && (
                      <UptimeClock
                        key={`${status?.engine.startedAt}:${status?.engine.uptimeSeconds}`}
                        uptimeSeconds={status?.engine.uptimeSeconds}
                      />
                    )}
                  </h1>
                  {remote && (
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 text-label">
                      {/* 遠端形態沒有連線按鈕，Monitor 圖示落在身份行標記操作對象。 */}
                      <Monitor
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                        strokeWidth={1.75}
                      />
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
                  {hasLocalAPI && (
                    <p className="max-w-[52ch] text-sm text-muted-foreground xl:text-body">
                      {stateNote}
                    </p>
                  )}
                </div>
                {hasLocalAPI ? (
                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    <Button
                      type="button"
                      ref={connectButtonRef}
                      variant="brand"
                      className="h-10 w-full gap-2 px-5 text-sm font-semibold max-md:min-h-11 sm:w-auto sm:min-w-36 xl:h-12 xl:min-w-40 xl:text-body"
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
                  </div>
                ) : (
                  // 遠端形態沒有連線操作，主操作讓給代理頁入口（與連接按鈕同一形制）。
                  remote && (
                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <Button
                        asChild
                        variant="brand"
                        className="h-10 w-full gap-2 px-5 text-sm font-semibold max-md:min-h-11 sm:w-auto sm:min-w-36 xl:h-12 xl:min-w-40 xl:text-body"
                      >
                        <Link to="/proxies">
                          <Globe aria-hidden="true" className="size-4" />
                          {t("viewProxies")}
                        </Link>
                      </Button>
                    </div>
                  )
                )}
                {/* 開場帶底部事實線：身份、三層狀態與管理入口落在一條畫布細線上，
                    取代獨立狀態條卡——少一層薄卡，開場更完整。移動端仍走頂部藥丸。 */}
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3">
                  {!remote && (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="grid size-7 shrink-0 place-items-center rounded-lg border border-brand/15 bg-brand-soft/85 text-brand shadow-2xs"
                      >
                        <Layers className="size-4" strokeWidth={1.75} />
                      </span>
                      <span
                        className="max-w-52 truncate text-sm font-semibold text-foreground"
                        title={configName}
                      >
                        {configName}
                      </span>
                    </span>
                  )}
                  {facts
                    .filter((fact) => !remote || fact.kind !== "core")
                    .map((fact) => {
                      const content = (
                        <>
                          <span className="flex items-center gap-1.5 text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
                            <FactIcon kind={fact.kind} />
                            {fact.label}
                          </span>
                          <b
                            className={cn(
                              "flex items-center gap-1.5 font-semibold tabular-nums [overflow-wrap:anywhere]",
                              fact.tone === "ok"
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
                        </>
                      );
                      const itemClass =
                        "inline-flex min-w-0 items-center gap-1.5 text-sm";
                      return fact.kind === "connections" ? (
                        <Link
                          key={fact.kind}
                          to={workspaceLink(location.search, "/connections")}
                          className={cn(
                            itemClass,
                            "rounded-sm transition-colors duration-150 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          )}
                        >
                          {content}
                        </Link>
                      ) : (
                        <span key={fact.kind} className={itemClass}>
                          {content}
                        </span>
                      );
                    })}
                  <span className="ms-auto flex shrink-0 items-center">
                    {remote ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
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
                        className="inline-flex h-8.5 items-center gap-1 rounded-full border border-brand/15 bg-brand-soft/85 px-3 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {t("manage")}
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 rtl:rotate-180"
                        />
                      </Link>
                    )}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* 移動端第一優先控制項：分流模式（規則/全局/直連） */}
          {isMobile && (
            <section className="relative z-10 shrink-0" aria-label={t("prefs")}>
              <SegmentedControl
                ariaLabel={tc("routingMode.title")}
                options={routingOptions}
                value={routingValue ?? null}
                disabled={pending}
                className="w-full justify-between rounded-2xl bg-card p-1 shadow-2xs border border-border/80"
                onChange={(mode) => void switchRouting(mode)}
              />
            </section>
          )}

          <div className="relative z-10 grid grid-cols-1 gap-3 lg:max-h-[40rem] lg:flex-1 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] xl:gap-4">
            <section
              className="bento flex min-w-0 flex-col justify-between gap-3 p-3.5 xl:gap-4 xl:p-5 max-lg:order-2"
              aria-label={t("trafficStats")}
            >
              {/* 卡头：标题「流量统计」，右侧时间窗控件；移动端控件独占一行，
                  四段在窄卡头内硬挤会被全局 flex-wrap 折成 1+1 两截 */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                <h2 className="shrink-0 text-body font-semibold tracking-tight text-foreground">
                  {t("trafficStats")}
                </h2>
                <SegmentedControl
                  ariaLabel={t("trafficHistory")}
                  options={trafficWindowOptions}
                  value={trafficWindow}
                  onChange={setTrafficWindow}
                  disabled={trafficState !== "open"}
                  size="sm"
                  className="max-md:basis-full"
                  itemClassName="max-md:flex-1"
                />
              </div>

              {/* 核心速率与用量三列指标：下载 / 上传 / 本次累计；居中平均分布。
                  自带上下呼吸：卡头与图表岛都是近邻，gap-3 不足以分隔 metric 级读数。 */}
              <dl className="grid grid-cols-3 divide-x divide-border/70 py-2 text-center xl:py-2.5">
                <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center">
                  <dt className="w-full truncate text-xs font-medium leading-none text-muted-foreground mb-1 text-center">
                    {t("download")}
                  </dt>
                  <dd className="w-full truncate text-metric font-semibold leading-none tracking-tight tabular-nums text-foreground max-md:text-subtitle text-center">
                    {trafficState === "open" && speed?.down !== undefined
                      ? formatDisplayRate(speed.down)
                      : "0 B/s"}
                  </dd>
                </div>

                <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center">
                  <dt className="w-full truncate text-xs font-medium leading-none text-muted-foreground mb-1 text-center">
                    {t("upload")}
                  </dt>
                  <dd className="w-full truncate text-metric font-semibold leading-none tracking-tight tabular-nums text-foreground max-md:text-subtitle text-center">
                    {trafficState === "open" && speed?.up !== undefined
                      ? formatDisplayRate(speed.up)
                      : "0 B/s"}
                  </dd>
                </div>

                <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center">
                  <dt className="w-full truncate text-xs font-medium leading-none text-muted-foreground mb-1 text-center">
                    {t("sessionTotal")}
                  </dt>
                  <dd className="w-full truncate text-metric font-semibold leading-none tracking-tight tabular-nums text-foreground max-md:text-subtitle text-center">
                    {sessionTotal !== null
                      ? formatDisplayTraffic(sessionTotal)
                      : "0 B"}
                  </dd>
                </div>
              </dl>

              {/* 核心走势与配额岛：与右侧 Hero 节点卡规格对齐，自适应填满高度 */}
              <div className="flex min-w-0 flex-1 flex-col justify-between rounded-2xl border border-border/80 bg-inset/50 p-3 xl:p-3.5">
                {/* 实时走势平滑曲线图 */}
                <div className="flex min-w-0 flex-1 items-stretch py-1">
                  <TrafficChart
                    samples={windowedSamples}
                    title={t("trafficHistory")}
                    stale={trafficState !== "open"}
                    staleLabel={t("streamStopped")}
                  />
                </div>

                {/* 岛底行：轻盈收纳的配额与微进度条（对齐右卡底行的「⇅ 节点选择 · 55 个成员 ›」） */}
                <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground truncate">
                    <Wallet
                      className="size-3.5 text-muted-foreground/80 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-xs truncate">
                      {t("quota.remaining")}
                    </span>
                  </span>

                  {sub && quota ? (
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="font-semibold tabular-nums text-foreground text-xs">
                        {formatDisplayTraffic(quota.remaining)}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {" "}
                          / {formatDisplayTraffic(sub.total)}
                        </span>
                      </span>
                      <div
                        className="h-1.5 w-16 sm:w-24 xl:w-28 overflow-hidden rounded-full bg-border/60"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(quotaPercent ?? 0)}
                        aria-label={t("quota.remaining")}
                      >
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                            (quotaPercent ?? 0) <= 10
                              ? "bg-destructive"
                              : "bg-brand",
                          )}
                          style={{
                            width: `${Math.min(100, Math.max(0, Math.round(quotaPercent ?? 0)))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="truncate text-xs text-muted-foreground">
                      {sub
                        ? t("quota.unknown")
                        : hasLocalAPI
                          ? t("noConfig")
                          : t("quotaUnavailable")}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section
              className="bento flex min-w-0 flex-col gap-3 p-3.5 max-lg:order-1 xl:gap-4 xl:p-5"
              aria-label={t("routingStrategy")}
            >
              {/* 卡头：标题「分流策略」，右侧全部策略链接 */}
              <div className="flex items-center justify-between gap-2">
                <h2 className="shrink-0 text-body font-semibold tracking-tight text-foreground">
                  {t("routingStrategy")}
                </h2>

                <Link
                  to="/proxies"
                  className="inline-flex shrink-0 min-h-7 items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-brand-text hover:underline hover:underline-offset-4 max-md:min-h-11 transition-colors"
                >
                  {t("allStrategies")}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 rtl:rotate-180"
                  />
                </Link>
              </div>

              {/* 策略组切换器：独占一行 */}
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="home-policy-group"
                  className="text-xs font-medium text-muted-foreground shrink-0"
                >
                  {t("strategyGroups")}
                </label>
                {group && available.length > 1 ? (
                  <div className="relative inline-flex min-w-0 flex-1 max-w-[210px]">
                    <NativeSelect
                      id="home-policy-group"
                      size="sm"
                      wrapperClassName="w-full"
                      className="h-7 w-full truncate rounded-full border border-border/80 bg-inset px-2.5 pe-6 py-0 text-xs font-semibold text-foreground hover:border-brand/40 hover:bg-card focus-visible:ring-1 focus-visible:ring-ring cursor-pointer transition-colors"
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
                  </div>
                ) : group ? (
                  <span className="truncate rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {group.name}
                  </span>
                ) : null}
              </div>

              {/* 当前选择核心卡片：节点展示与选择合二为一，自适应填充高度，杜绝截断 */}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
                className="group mt-auto flex min-w-0 flex-1 flex-col items-stretch justify-between rounded-2xl border border-border/80 bg-inset/50 p-3.5 text-start transition-[border-color,background-color,box-shadow] duration-150 ease-out max-h-[17rem] hover:border-brand/40 hover:bg-inset/80 hover:shadow-xs focus-visible:outline-2 focus-visible:outline-ring cursor-pointer motion-reduce:transition-none"
              >
                {/* 卡片顶行：当前节点标签 + 独立延迟药丸 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span
                      className="size-1.5 rounded-full bg-brand"
                      aria-hidden="true"
                    />
                    {t("currentNode")}
                  </span>

                  {leafDelay ? (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums shadow-2xs transition-colors duration-200",
                        // Same traffic-light family as the proxies page
                        // (DESIGN.md latency tokens), not status colors.
                        leafDelay < 150
                          ? "bg-latency-good text-latency-good-text"
                          : leafDelay <= 400
                            ? "bg-latency-medium text-latency-medium-text"
                            : "bg-latency-slow text-latency-slow-text",
                      )}
                      title={t("lastMeasured")}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 rounded-full transition-colors duration-200",
                          leafDelay < 150
                            ? "bg-latency-good-dot"
                            : leafDelay <= 400
                              ? "bg-latency-medium-dot"
                              : "bg-latency-slow-dot",
                        )}
                      />
                      {leafDelay} ms
                    </span>
                  ) : leafNodeName ? (
                    <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {px("untested")}
                    </span>
                  ) : null}
                </div>

                {/* 卡片主内容：48px 国旗 + 全宽节点名（无右侧拥挤元素，彻底不截断） */}
                <div className="my-3 flex min-w-0 flex-1 items-center gap-3.5">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xs group-hover:scale-105 transition-transform xl:size-12"
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

                  <div className="min-w-0 flex-1">
                    <span
                      className="block truncate text-base font-bold tracking-tight text-foreground group-hover:text-brand-text transition-colors"
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
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {chain.length > 2
                        ? `${t("via")} ${chain.slice(1, -1).join(" › ")}`
                        : strategyTypeLabel(group?.type)}
                    </span>
                  </div>
                </div>

                {/* 卡片底行：合二为一的节点选择操作指引 */}
                <div className="flex items-center justify-between border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium text-foreground group-hover:text-brand-text transition-colors">
                    <ArrowUpDown
                      className="size-3.5 text-brand"
                      aria-hidden="true"
                    />
                    <span>{t("nodeSelection")}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-brand-text transition-colors">
                    {group?.all && (
                      <span>
                        {group.all.length} {t("strategyMembers")}
                      </span>
                    )}
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </button>

              {/* 卡底行：組內延遲分布（與左卡配額行同構），來自同一份 history 數據。 */}
              {delayStats && (
                <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2.5 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <Gauge
                      className="size-3.5 shrink-0 text-muted-foreground/80"
                      aria-hidden="true"
                    />
                    <span className="truncate">{t("latencyDistribution")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-latency-good-dot"
                      />
                      {delayStats.good} {t("latencyGood")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-latency-medium-dot"
                      />
                      {delayStats.medium} {t("latencyMedium")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-latency-slow-dot"
                      />
                      {delayStats.slow} {t("latencySlow")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-muted-foreground/40"
                      />
                      {delayStats.untested} {px("untested")}
                    </span>
                  </span>
                </div>
              )}
            </section>
          </div>

          {/* 第四行：路由模式與流量接管一行（遠端形態只有路由模式卡，佔半寬）；
              移動端已在頂部提供分流模式。 */}
          {!isMobile && (
            <div className="relative z-10 grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] xl:gap-4">
              <section
                className="bento flex min-w-0 flex-col justify-between gap-2 p-3 lg:flex-row lg:flex-wrap lg:items-center xl:gap-3 xl:p-4"
                aria-label={t("prefs")}
              >
                {/* 左欄身份：圖示 + 標題 + 描述，右欄留給路由模式上圖下字分段塊。 */}
                <div className="flex min-w-0 items-center gap-2.5 lg:shrink-0">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-control bg-inset text-muted-foreground lg:hidden"
                  >
                    <SlidersHorizontal
                      className="size-4.5"
                      strokeWidth={1.75}
                    />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground lg:whitespace-nowrap">
                      {t("prefs")}
                    </h2>
                    <p className="text-xs text-muted-foreground lg:whitespace-nowrap">
                      {t("prefsDesc")}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-0 shrink-0 flex-col">
                  <SegmentedControl
                    ariaLabel={tc("routingMode.title")}
                    options={routingOptions}
                    value={routingValue ?? null}
                    disabled={pending}
                    className="grid w-full grid-cols-3 lg:w-auto"
                    onChange={(mode) => void switchRouting(mode)}
                  />
                </div>
              </section>

              {hasLocalAPI && (
                <section
                  className="bento flex min-w-0 flex-col justify-between gap-2 p-3 lg:flex-row lg:flex-wrap lg:items-center xl:gap-3 xl:p-4"
                  aria-label={t("takeoverMode")}
                >
                  {/* 左欄身份與接管說明 */}
                  <div className="flex min-w-0 items-center gap-2.5 lg:shrink-0">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-control bg-inset text-muted-foreground lg:hidden"
                    >
                      <Layers className="size-4.5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-foreground">
                        {t("takeoverMode")}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {t("takeoverDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:items-center sm:divide-x sm:divide-y-0 lg:min-w-64 lg:flex-1 lg:grid-cols-[calc(50%+1rem)_minmax(0,1fr)] lg:ps-3">
                    {/* System Proxy */}
                    <div className="flex min-w-0 items-center justify-between gap-2 py-2 sm:pe-2.5 sm:py-0 lg:justify-end">
                      <div className="flex min-w-0 items-center gap-2">
                        <Network
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground lg:hidden"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <strong className="text-sm leading-tight font-semibold text-foreground lg:whitespace-nowrap">
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
                          void run(
                            () => setMode({ systemProxy: checked }),
                            false,
                          )
                        }
                        aria-label={t("sysproxy")}
                      />
                    </div>

                    {/* Virtual NIC (TUN) */}
                    <div className="flex min-w-0 items-center justify-between gap-2 py-2 sm:ps-2.5 sm:py-0 lg:justify-end">
                      <div className="flex min-w-0 items-center gap-2">
                        <Shield
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground lg:hidden"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <strong className="text-sm leading-tight font-semibold text-foreground lg:whitespace-nowrap">
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
          )}
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
            return nodeSelection.select(groupName, nodeName);
          }}
        />
      )}

      <AlertDialog
        open={connectError !== null}
        onOpenChange={(open) => {
          if (!open) {
            disarmConsentRetry();
            setConnectError(null);
          }
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
                  : connectError?.kind === "vpn_consent"
                    ? t("vpnConsentTitle")
                    : t("connectFailed")}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {connectError?.kind === "port_conflict"
                ? t("portConflictDesc")
                : connectError?.kind === "tun_denied"
                  ? t("tunDeniedDesc")
                  : connectError?.kind === "vpn_consent"
                    ? t("vpnConsentDesc")
                    : connectError?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap">
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            {connectError?.kind === "vpn_consent" && (
              <AlertDialogAction onClick={() => connectUp()}>
                {tc("retry")}
              </AlertDialogAction>
            )}
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
                    // 對話框點擊即關閉；失敗只能靠 toast 交代，不捕獲會變成
                    // 無回應的 unhandled rejection。
                    try {
                      await setMode({ systemProxy: true, tun: false });
                      await run(() => up(), false);
                    } catch (err) {
                      toast.error(r(errorKind(err)), { duration: 6000 });
                    }
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
