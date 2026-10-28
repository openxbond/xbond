import { Header, Button } from "@components";
import { useAction } from "@lib/actions";
import { formatRate } from "@lib/activity";
import { formatTraffic } from "@lib/helper";
import type { Snapshot } from "@lib/request";
import {
  workspaceLink,
  focusedGroup,
  strategyPath,
  controllerIdentity,
} from "@lib/workspace";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useGeneral,
  useI18n,
  useLocalAPI,
  useProxy,
  useProxyMapping,
  useStreamReader,
  useStreamState,
  identityAtom,
} from "@stores";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import "./style.scss";

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v2",
  {},
);

export default function Connect() {
  const { translation, lang } = useI18n();
  const { t: ui } = translation("ClientUI");
  const { t: r } = translation("Runtime");
  const { t: c } = translation("Connect");
  const controller = useAPIInfo();
  const client = useClient();
  const location = useLocation();
  const { general, update } = useGeneral();
  const caps = useCapabilities();
  const { groups, global } = useProxy();
  const mapping = useProxyMapping();
  const { hasLocalAPI, isLocalTarget, status, up, down, setMode, refresh } =
    useLocalAPI();
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
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) =>
      setSpeed(items.at(-1) ?? null);
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);
  useEffect(() => {
    const onData = (items: Snapshot[]) => setSnapshot(items.at(-1) ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);
  const running = hasLocalAPI && (status?.engine.running ?? false);
  const sub = hasLocalAPI ? status?.activeSub : null;
  const used = sub ? sub.upload + sub.download : 0;
  const ratio =
    sub && sub.total > 0 ? Math.min(100, (used / sub.total) * 100) : 0;
  const coreOpen = trafficState === "open";
  const takeover = hasLocalAPI ? status?.preferences.takeoverMode : undefined;
  const currentMode = (
    hasLocalAPI ? status?.preferences.routingMode : general.mode
  )?.toLowerCase();
  const link = (path: string, params: Record<string, string> = {}) =>
    workspaceLink(location.search, path, params);
  const modes = hasLocalAPI ? ["rule", "global", "direct"] : caps.modes;
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString(lang.replace("_", "-"));

  return (
    <div className="page connect-page">
      <Header title={ui("home")}>
        <span className="home-context">
          {isLocalTarget ? ui("local") : ui("remote")} ·{" "}
          {controller.name || new URL(controller.url).hostname}
        </span>
      </Header>
      <section className="home-connection" aria-label={ui("control")}>
        <div>
          <div className="home-status">
            <span
              className={
                coreOpen || running ? "status-dot online" : "status-dot"
              }
            />
            {isLocalTarget && !hasLocalAPI
              ? ui("unknown")
              : hasLocalAPI
                ? running
                  ? ui("connected")
                  : ui("stopped")
                : r(trafficState)}
          </div>
          <h2>{isLocalTarget ? ui("local") : ui("remote")}</h2>
          <p>{hasLocalAPI ? sub?.name || ui("noConfig") : ui("remoteNote")}</p>
        </div>
        <div className="home-connection-actions">
          {isLocalTarget && !hasLocalAPI ? (
            <Button onClick={() => void refresh()}>{r("retry")}</Button>
          ) : hasLocalAPI ? (
            <Button
              disabled={pending || (!running && !sub)}
              onClick={() => void run(() => (running ? down() : up()), false)}
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
          {takeover && (
            <Link
              className="section-link"
              to={link("/settings", { section: "network" })}
            >
              {ui(takeover)}
              {status?.engine.mixedPort ? " · " + status.engine.mixedPort : ""}
            </Link>
          )}
        </div>
      </section>
      {hasLocalAPI && !sub && (
        <section className="home-onboarding">
          <h2>{ui("noConfig")}</h2>
          <Link
            className="section-link"
            to={link("/settings", { section: "configuration", track: "xbond" })}
          >
            {ui("bind")}
          </Link>
          <Link
            className="section-link"
            to={link("/settings", {
              section: "configuration",
              track: "universal",
            })}
          >
            {ui("import")}
          </Link>
        </section>
      )}
      <section className="home-traffic" aria-label={ui("traffic")}>
        {(["down", "up"] as const).map((direction) => (
          <div className="home-traffic-item" key={direction}>
            <span>{ui(direction === "down" ? "download" : "upload")}</span>
            <strong>
              {trafficState === "open" && speed
                ? formatRate(speed[direction])
                : "—"}
            </strong>
            <small>
              {ui("total")}{" "}
              <b>
                {connectionState === "open" && snapshot
                  ? formatTraffic(
                      direction === "down"
                        ? snapshot.downloadTotal
                        : snapshot.uploadTotal,
                    )
                  : "—"}
              </b>
            </small>
          </div>
        ))}
        <div className="home-traffic-note">
          {ui("traffic")}
          <br />
          {r(trafficState)}
        </div>
      </section>
      <div className="home-workspace">
        <section className="home-section">
          <div className="section-heading">
            <h2>{ui("source")}</h2>
            <Link
              className="section-link"
              to={link("/settings", { section: "configuration" })}
            >
              {ui("manage")}
            </Link>
          </div>
          <dl className="home-facts">
            <div>
              <dt>{ui("source")}</dt>
              <dd>
                {sub?.name || (hasLocalAPI ? ui("noSource") : ui("readonly"))}
              </dd>
            </div>
            <div>
              <dt>{ui("controller")}</dt>
              <dd>{controller.name || new URL(controller.url).hostname}</dd>
            </div>
            {sub?.lastUpdated ? (
              <div>
                <dt>{ui("updated")}</dt>
                <dd>{date(sub.lastUpdated)}</dd>
              </div>
            ) : null}
          </dl>
          {sub && sub.total > 0 && (
            <div className="home-quota">
              <div>
                <span>{ui("quota")}</span>
                <strong>
                  {formatTraffic(used)} / {formatTraffic(sub.total)}
                </strong>
              </div>
              <progress value={ratio} max={100} aria-label={ui("quota")} />
              <p>
                {c("quota.remaining")}{" "}
                {formatTraffic(Math.max(0, sub.total - used))}
              </p>
            </div>
          )}
          {sub && sub.expire > 0 && (
            <dl className="home-facts">
              <div>
                <dt>{ui("expiry")}</dt>
                <dd>{date(sub.expire)}</dd>
              </div>
            </dl>
          )}
        </section>
        <section className="home-section">
          <div className="section-heading">
            <h2>{ui("strategy")}</h2>
            <Link
              className="section-link"
              to={link("/proxies", group ? { group: group.name } : {})}
            >
              {ui("openProxies")}
            </Link>
          </div>
          <label className="home-group-label">
            {ui("chooseGroup")}
            <select
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
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {group ? (
            <>
              <p className="home-strategy-path">{chain.join(" → ") || "—"}</p>
              <p className="home-section-note">
                {group.type} · {group.all.length} {ui("members")} ·{" "}
                {ui("strategyNote")}
              </p>
            </>
          ) : (
            <p className="home-section-note">{ui("noGroup")}</p>
          )}
          <div className="home-routing">
            <span>{ui("routing")}</span>
            <div className="routing-options">
              {modes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={currentMode === mode.toLowerCase()}
                  disabled={
                    pending ||
                    (isLocalTarget && !hasLocalAPI) ||
                    (!hasLocalAPI && caps.kind === "unknown")
                  }
                  onClick={() =>
                    void run(async () => {
                      if (hasLocalAPI) {
                        await setMode({
                          routing: mode.toLowerCase() as
                            | "rule"
                            | "global"
                            | "direct",
                        });
                      } else {
                        await client.updateConfig({ mode });
                        await update();
                      }
                    })
                  }
                >
                  {["rule", "global", "direct"].includes(mode.toLowerCase())
                    ? ui(mode.toLowerCase() as "rule" | "global" | "direct")
                    : mode}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
      <details className="home-evidence">
        <summary>{ui("details")}</summary>
        <dl className="home-facts">
          {hasLocalAPI && status ? (
            [
              status.threeTier.core,
              status.threeTier.takeover,
              status.threeTier.egress,
            ].map((tier, index) => (
              <div key={index}>
                <dt>{tier.label}</dt>
                <dd>{tier.detail}</dd>
              </div>
            ))
          ) : (
            <>
              <div>
                <dt>{c("tiers.core")}</dt>
                <dd>{r(trafficState)}</dd>
              </div>
              <div>
                <dt>{c("tiers.takeover")}</dt>
                <dd>{ui("unknown")}</dd>
              </div>
              <div>
                <dt>{c("tiers.egress")}</dt>
                <dd>{ui("unknown")}</dd>
              </div>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
