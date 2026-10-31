import { Header } from "@components";
import Connections from "@containers/Connections";
import Diagnostics from "@containers/Diagnostics";
import Logs from "@containers/Logs";
import { useCapabilities, useStreamReader, useStreamState } from "@stores";
import { formatRate } from "@xbond/client/activity";
import { formatTraffic } from "@xbond/client/helper";
import type { Snapshot } from "@xbond/client/request";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import "./style.scss";

const VIEWS = ["logs", "connections", "diagnostics"] as const;
type ActivityView = (typeof VIEWS)[number];

export default function Activity() {
  const { t: sb } = useTranslation("sidebar");
  const { t: r } = useTranslation("runtime");
  const { t: ov } = useTranslation("overview");
  const caps = useCapabilities();
  const [params, setParams] = useSearchParams();
  const requested = params.get("view") as ActivityView | null;
  const activeTab: ActivityView = VIEWS.includes(requested as ActivityView)
    ? (requested as ActivityView)
    : "logs";
  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const state = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const memory = useStreamReader<{ inuse: number }>(
    caps.memory ? "memory" : null,
  );
  const [speed, setSpeed] = useState({ up: 0, down: 0 });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      const item = items.at(-1);
      if (item) setSpeed(item);
    };
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);
  useEffect(() => {
    const onData = (items: Snapshot[]) => setSnapshot(items.at(-1) ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);
  useEffect(() => {
    const onData = (items: { inuse: number }[]) =>
      setMemoryBytes(items.at(-1)?.inuse ?? null);
    memory.subscribe("data", onData);
    return () => memory.unsubscribe("data", onData);
  }, [memory]);
  function select(view: ActivityView) {
    setParams(
      (previous) => {
        previous.set("view", view);
        return previous;
      },
      { replace: true },
    );
  }
  function cycle(current: ActivityView, step: number): ActivityView {
    const index = VIEWS.indexOf(current);
    return VIEWS[(index + step + VIEWS.length) % VIEWS.length];
  }
  return (
    <div className="page activity-page">
      <Header title={sb("activity")}>
        <output className="home-context">{r(state)}</output>
      </Header>
      <dl className="activity-summary">
        <div>
          <dt>{ov("upload")}</dt>
          <dd>{state === "open" ? formatRate(speed.up) : "—"}</dd>
        </div>
        <div>
          <dt>{ov("download")}</dt>
          <dd>{state === "open" ? formatRate(speed.down) : "—"}</dd>
        </div>
        <div>
          <dt>{sb("connections")}</dt>
          <dd>
            {connectionState === "open"
              ? (snapshot?.connections.length ?? "—")
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{ov("total")}</dt>
          <dd>
            {connectionState === "open" && snapshot
              ? formatTraffic(snapshot.uploadTotal + snapshot.downloadTotal)
              : "—"}
          </dd>
        </div>
        {caps.memory && (
          <div>
            <dt>{ov("memory")}</dt>
            <dd>{memoryBytes === null ? "—" : formatTraffic(memoryBytes)}</dd>
          </div>
        )}
      </dl>
      <div className="activity-tabs" role="tablist" aria-label={sb("activity")}>
        {VIEWS.map((view) => (
          <button
            type="button"
            key={view}
            id={"tab-" + view}
            role="tab"
            aria-controls={"panel-" + view}
            aria-selected={activeTab === view}
            tabIndex={activeTab === view ? 0 : -1}
            onClick={() => select(view)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? VIEWS[0]
                    : event.key === "End"
                      ? VIEWS[VIEWS.length - 1]
                      : cycle(view, event.key === "ArrowRight" ? 1 : -1);
                select(next);
                document.getElementById("tab-" + next)?.focus();
              }
            }}
          >
            {sb(view)}
          </button>
        ))}
      </div>
      <div className="activity-content">
        {VIEWS.map((view) => (
          <div
            key={view}
            id={"panel-" + view}
            role="tabpanel"
            aria-labelledby={"tab-" + view}
            hidden={activeTab !== view}
          >
            {view === "logs" && <Logs />}
            {view === "connections" && <Connections />}
            {view === "diagnostics" && <Diagnostics />}
          </div>
        ))}
      </div>
    </div>
  );
}
