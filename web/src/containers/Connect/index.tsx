import { Header, Button, success } from "@components";
import { CopyButton } from "@components/CopyButton";
import { useAction } from "@lib/actions";
import { formatRate } from "@lib/activity";
import { formatTraffic } from "@lib/helper";
import { subscriptionQuota } from "@lib/localapi";
import { useNodeSelection } from "@lib/node-selection";
import type { Snapshot } from "@lib/request";
import { focusedGroup, strategyPath, controllerIdentity } from "@lib/workspace";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useGeneral,
  useI18n,
  useLocalAPI,
  useProxy,
  useProxyMapping,
  useSubscriptions,
  useVersion,
  useStreamReader,
  useStreamState,
  identityAtom,
} from "@stores";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import "./style.scss";

interface TrafficSample {
  up: number;
  down: number;
  at: number;
}

function TrafficChart({
  samples,
  title,
  empty,
  downloadLabel,
  uploadLabel,
}: {
  samples: TrafficSample[];
  title: string;
  empty: string;
  downloadLabel: string;
  uploadLabel: string;
}) {
  if (samples.length < 2) return <p className="home-chart-empty">{empty}</p>;
  const maximum = Math.max(
    1,
    ...samples.flatMap((sample) => [sample.up, sample.down]),
  );
  const points = (direction: "up" | "down") =>
    samples
      .map(
        (sample, index) =>
          (index / (samples.length - 1)) * 600 +
          "," +
          (80 - (sample[direction] / maximum) * 70),
      )
      .join(" ");
  return (
    <div className="home-chart-wrapper">
      <div className="home-chart-legend">
        <span className="legend-item download">
          <span className="dot" /> {downloadLabel}
        </span>
        <span className="legend-item upload">
          <span className="dot" /> {uploadLabel}
        </span>
        <span className="peak-rate">{formatRate(maximum)}</span>
      </div>
      <div className="home-chart">
        <svg viewBox="0 0 600 80" preserveAspectRatio="none" aria-label={title}>
          <title>{title}</title>
          <path d="M0 10h600M0 45h600M0 75h600" className="chart-grid" />
          <polyline points={points("down")} className="download-line" />
          <polyline points={points("up")} className="upload-line" />
        </svg>
      </div>
    </div>
  );
}

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

export default function Connect() {
  const { translation, lang } = useI18n();
  const { t: ui } = translation("ClientUI");
  const { t: r } = translation("Runtime");
  const { t: c } = translation("Connect");
  const { t: settingsText } = translation("Settings");
  const controller = useAPIInfo();
  const client = useClient();
  const { general, update } = useGeneral();
  const caps = useCapabilities();
  const version = useVersion();
  const { updateSub } = useSubscriptions();
  const nodeSelection = useNodeSelection();
  const { groups, global } = useProxy();
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

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controllerIdentity(controller.id, controller.url);
  const group = focusedGroup(available, focus[focusKey]);
  const chain = strategyPath(group, mapping);

  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const memory = useStreamReader<{ inuse: number }>(
    caps.memory ? "memory" : null,
  );
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  const [history, setHistory] = useState<TrafficSample[]>([]);
  const [pingDelay, setPingDelay] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    const onData = (items: { inuse: number }[]) =>
      setMemoryBytes(items.at(-1)?.inuse ?? null);
    memory.subscribe("data", onData);
    return () => memory.unsubscribe("data", onData);
  }, [memory]);

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

  async function testCurrentNode() {
    if (!group?.now) return;
    setPinging(true);
    try {
      const res = await client.getProxyDelay(group.now);
      setPingDelay(res.data.delay);
    } catch {
      setPingDelay(-1);
    } finally {
      setPinging(false);
    }
  }

  function copyTerminalCommand() {
    const cmd = `$env:all_proxy="http://127.0.0.1:${mixedPort}"`;
    navigator.clipboard.writeText(cmd).then(() => {
      success(ui("copied"));
    });
  }

  return (
    <div className="page connect-page">
      <Header title={ui("home")}>
        <div className="home-header-badge">
          <span className={`status-dot ${active ? "online" : ""}`} />
          <span className="text-sm font-medium">
            {isLocalTarget ? ui("local") : ui("remote")} ·{" "}
            {controller.name || new URL(controller.url).hostname}
          </span>
        </div>
      </Header>

      {localConfig && !status && (
        <aside
          className="home-status-notice card"
          role={localError ? "alert" : "status"}
        >
          <span>{localError ? ui("statusReadFailed") : r("loading")}</span>
          {localError && (
            <Button
              disabled={pending}
              onClick={() => void run(() => refresh(), false)}
            >
              {r("retry")}
            </Button>
          )}
        </aside>
      )}

      {/* Bento Grid layout */}
      <div className="connect-bento-grid">
        {/* CARD 1: 連線與三層狀態主控卡 (6 columns) */}
        <section
          className={`bento-card card connect-master-card ${active ? "is-running" : ""}`}
        >
          <div className="card-top-row">
            <div className="master-title-area">
              <div className="master-aura-wrap">
                <span className={`master-aura ${active ? "active" : ""}`} />
              </div>
              <div className="master-status-text">
                <h2>
                  {hasLocalAPI
                    ? running
                      ? ui("connected")
                      : ui("stopped")
                    : r(trafficState)}
                </h2>
                <span className="master-subtext">
                  {hasLocalAPI
                    ? running
                      ? `Uptime: ${status?.engine.uptime || "0m"}`
                      : ui("noConfig")
                    : ui("remoteNote")}
                </span>
              </div>
            </div>

            <div className="master-actions">
              {hasLocalAPI ? (
                <Button
                  type={running ? "normal" : "brand"}
                  disabled={pending || (!running && !sub)}
                  className="connect-toggle-btn"
                  onClick={() =>
                    void run(() => (running ? down() : up()), false)
                  }
                >
                  {pending
                    ? r("loading")
                    : running
                      ? ui("disconnect")
                      : ui("connect")}
                </Button>
              ) : (
                <Button onClick={() => setIdentity(false)}>{r("edit")}</Button>
              )}
            </div>
          </div>

          <div className="port-info-bar">
            <span className="port-label">{ui("port")}:</span>
            <code className="port-val">127.0.0.1:{mixedPort}</code>
            <CopyButton
              value={`127.0.0.1:${mixedPort}`}
              label={ui("copyLink")}
            />
          </div>

          {/* Three-Tier Status Row (Straightforward, Uncollapsed) */}
          <div className="three-tier-row">
            <div
              className={`tier-pill ${status?.threeTier.core.ok || active ? "ok" : ""}`}
            >
              <span className="tier-indicator" />
              <div className="tier-content">
                <span className="tier-name">{c("tiers.core")}</span>
                <span className="tier-desc">
                  {hasLocalAPI
                    ? status?.engine.running
                      ? version.version || "sing-box"
                      : ui("stopped")
                    : r(trafficState)}
                </span>
              </div>
            </div>

            <div
              className={`tier-pill ${status?.threeTier.takeover.ok ? "ok" : ""}`}
            >
              <span className="tier-indicator" />
              <div className="tier-content">
                <span className="tier-name">{c("tiers.takeover")}</span>
                <span className="tier-desc">
                  {takeover ? ui(takeover) : ui("unknown")}
                </span>
              </div>
            </div>

            <div
              className={`tier-pill ${status?.threeTier.egress.ok ? "ok" : ""}`}
            >
              <span className="tier-indicator" />
              <div className="tier-content">
                <span className="tier-name">{c("tiers.egress")}</span>
                <span className="tier-desc">
                  {status?.threeTier.egress.ok
                    ? `${status?.threeTier.egress.detail || "已驗證"}`
                    : ui("unknown")}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 2: 當前節點快捷卡 (6 columns) */}
        <section className="bento-card card node-quick-card">
          <div className="card-header-line">
            <div className="card-title-group">
              <h3 className="card-title">{c("strategy.title")}</h3>
              <span className="strategy-chain-text">
                {chain.join(" → ") || ui("noGroup")}
              </span>
            </div>
            <Link to="/proxies" className="section-link">
              {ui("proxies")} &rarr;
            </Link>
          </div>

          <div className="node-quick-controls">
            <div className="control-field">
              <span className="control-label">{ui("chooseGroup")}</span>
              <select
                className="select-input"
                value={group?.name || ""}
                onChange={(e) =>
                  setFocus((previous) => ({
                    ...previous,
                    [focusKey]: e.target.value,
                  }))
                }
              >
                <option value="">{ui("chooseGroup")}</option>
                {available.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.all.length})
                  </option>
                ))}
              </select>
            </div>

            <div className="control-field">
              <span className="control-label">{ui("currentNode")}</span>
              <div className="node-select-row">
                <select
                  className="select-input flex-1"
                  value={group?.now || ""}
                  disabled={
                    !group || group.type !== "Selector" || nodeSelection.pending
                  }
                  onChange={(event) => {
                    if (group) {
                      void nodeSelection.select(group.name, event.target.value);
                    }
                  }}
                >
                  {group ? (
                    group.all.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))
                  ) : (
                    <option value="">{c("strategy.noNodeSelected")}</option>
                  )}
                </select>
                <Button
                  disabled={!group?.now || pinging}
                  onClick={() => void testCurrentNode()}
                  className="ping-btn"
                >
                  {pinging
                    ? "..."
                    : pingDelay !== null
                      ? pingDelay > 0
                        ? `${pingDelay}ms`
                        : "Timeout"
                      : c("strategy.testDelay")}
                </Button>
              </div>
            </div>
          </div>

          <div className="node-footer-meta">
            {group?.now && (
              <div className="active-node-name">
                <span className="badge">{group.type}</span>
                <span className="node-label-text">{group.now}</span>
                <CopyButton value={group.now} label={ui("copyNode")} />
              </div>
            )}
            {(nodeSelection.pending || nodeSelection.result !== "idle") && (
              <span className="node-switch-notice">
                {ui(
                  nodeSelection.pending
                    ? "switching"
                    : nodeSelection.result === "success"
                      ? "switched"
                      : "switchFailed",
                )}
              </span>
            )}
          </div>
        </section>

        {/* CARD 3: 網絡接管與路由模式卡 (6 columns) */}
        <section className="bento-card card mode-control-card">
          <div className="mode-block">
            <div className="mode-label-row">
              <h3 className="card-title">{ui("takeoverMode")}</h3>
              <span className="mode-desc-text">
                {takeover === "tun"
                  ? settingsText("takeover.tunDesc")
                  : takeover === "port"
                    ? settingsText("takeover.portDesc")
                    : settingsText("takeover.sysproxyDesc")}
              </span>
            </div>
            {hasLocalAPI ? (
              <div className="segmented-control">
                {(["sysproxy", "tun", "port"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={`segment-btn ${takeover === mode ? "active" : ""}`}
                    disabled={pending}
                    onClick={() => void run(() => setMode({ mode }))}
                  >
                    {ui(mode)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ui("remoteNote")}
              </p>
            )}
          </div>

          <div className="mode-block">
            <div className="mode-label-row">
              <h3 className="card-title">{ui("routing")}</h3>
              <span className="mode-desc-text">
                {currentMode === "global"
                  ? c("routingMode.global")
                  : currentMode === "direct"
                    ? c("routingMode.direct")
                    : c("routingMode.rule")}
              </span>
            </div>
            <div className="segmented-control">
              {(["rule", "global", "direct"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={`segment-btn ${currentMode === mode ? "active" : ""}`}
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      if (hasLocalAPI) {
                        await setMode({ routing: mode });
                      } else {
                        await client.updateConfig({ mode });
                        await update();
                      }
                    })
                  }
                >
                  {ui(mode)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* CARD 4: 活躍訂閱與配額環卡 (6 columns) */}
        <section className="bento-card card active-sub-card">
          <div className="card-header-line">
            <div className="card-title-group">
              <h3 className="card-title">{c("quota.title")}</h3>
              <span className="sub-source-text">
                {sub ? sub.name : ui("noConfig")}
              </span>
            </div>
            <Link to="/subscriptions" className="section-link">
              {ui("manage")} &rarr;
            </Link>
          </div>

          {sub && quota ? (
            <div className="sub-quota-showcase">
              <div className="quota-ring-wrap">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle
                    className="quota-track"
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    strokeWidth="8"
                  />
                  <circle
                    className="quota-value"
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    strokeWidth="8"
                    pathLength="100"
                    strokeDasharray={`${quota.remainingPercent} 100`}
                    strokeLinecap={
                      quota.remainingPercent > 0 ? "round" : "butt"
                    }
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <span className="quota-ring-num">
                  {Math.round(quota.remainingPercent)}%
                </span>
              </div>

              <div className="quota-text-details">
                <div className="quota-stat-primary">
                  <span className="stat-label">{c("quota.remaining")}</span>
                  <strong className="stat-value">
                    {formatTraffic(quota.remaining)}
                  </strong>
                </div>
                <div className="quota-stat-secondary">
                  <span>
                    {ui("used")}: {formatTraffic(quota.used)} /{" "}
                    {formatTraffic(sub.total)}
                  </span>
                  {sub.expire > 0 && (
                    <span>
                      {ui("expiry")}:{" "}
                      {new Date(sub.expire * 1000).toLocaleDateString(
                        lang.replace("_", "-"),
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="sub-empty-hint">
              <p>{ui("noConfig")}</p>
              <Link
                to="/subscriptions"
                className="button button-brand mt-2 inline-block"
              >
                {ui("import")}
              </Link>
            </div>
          )}

          {sub && (
            <div className="sub-footer-actions">
              <Button
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await updateSub(sub.id);
                    await refresh();
                  })
                }
              >
                {ui("updateSubscription")}
              </Button>
              {sub.urlOrFile && /^https?:\/\//i.test(sub.urlOrFile) && (
                <CopyButton value={sub.urlOrFile} label={ui("copyLink")} />
              )}
            </div>
          )}
        </section>

        {/* CARD 5: 流量羅盤與即時走勢卡 (8 columns) */}
        <section className="bento-card card traffic-compass-card">
          <div className="card-header-line">
            <h3 className="card-title">{ui("compass")}</h3>
            <span className="traffic-live-indicator">
              <span
                className={`pulse-dot ${trafficState === "open" ? "online" : ""}`}
              />
              {trafficState === "open" ? "Live" : r(trafficState)}
            </span>
          </div>

          <div className="traffic-chart-box">
            <TrafficChart
              samples={history}
              title={ui("trafficHistory")}
              empty={ui("collectingSamples")}
              downloadLabel={ui("download")}
              uploadLabel={ui("upload")}
            />
          </div>

          <div className="traffic-metrics-grid">
            <div className="metric-box">
              <span className="metric-label">{ui("download")}</span>
              <strong className="metric-value">
                {trafficState === "open" && speed
                  ? formatRate(speed.down)
                  : "—"}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-label">{ui("upload")}</span>
              <strong className="metric-value">
                {trafficState === "open" && speed ? formatRate(speed.up) : "—"}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-label">{ui("total")}</span>
              <span className="metric-value font-mono text-sm">
                {connectionState === "open" && snapshot
                  ? formatTraffic(snapshot.uploadTotal + snapshot.downloadTotal)
                  : "—"}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">{ui("activeConnections")}</span>
              <span className="metric-value font-mono text-sm">
                {connectionState === "open" && snapshot
                  ? snapshot.connections.length
                  : 0}
                {caps.memory && memoryBytes
                  ? ` (${formatTraffic(memoryBytes)})`
                  : ""}
              </span>
            </div>
          </div>
        </section>

        {/* CARD 6: 環境與快捷工具卡 (4 columns) */}
        <section className="bento-card card quick-tools-card">
          <div className="card-header-line">
            <h3 className="card-title">{ui("environment")}</h3>
            <Link to="/diagnostics" className="section-link">
              {ui("testNavigation")} &rarr;
            </Link>
          </div>

          <div className="tools-list">
            <div className="tool-item">
              <span className="tool-label">{ui("allowLan")}</span>
              <input
                type="checkbox"
                checked={
                  hasLocalAPI
                    ? (status?.preferences.allowLan ?? false)
                    : general.allowLan
                }
                disabled={
                  pending ||
                  (isLocalTarget && !hasLocalAPI) ||
                  (!hasLocalAPI && !caps.editLan)
                }
                onChange={(event) => {
                  const allowLan = event.target.checked;
                  void run(async () => {
                    if (hasLocalAPI) await setMode({ allowLan });
                    else {
                      await client.updateConfig({ "allow-lan": allowLan });
                      await update();
                    }
                  });
                }}
              />
            </div>

            <div className="tool-item">
              <span className="tool-label">{ui("port")}</span>
              <code className="text-xs font-mono">{mixedPort}</code>
            </div>

            <div className="tool-action-box">
              <span className="text-xs text-muted-foreground block mb-1">
                終端代理環境變數：
              </span>
              <Button onClick={copyTerminalCommand} className="w-full text-xs">
                複製 PowerShell 代理命令
              </Button>
            </div>

            <div className="quick-links-group">
              <Link to="/connections" className="quick-link-pill">
                連線明細
              </Link>
              <Link to="/rules" className="quick-link-pill">
                分流規則
              </Link>
              <Link to="/logs" className="quick-link-pill">
                核心日誌
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
