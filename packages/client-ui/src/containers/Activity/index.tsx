import { Button, Header } from "@components";
import Connections from "@containers/Connections";
import Logs from "@containers/Logs";
import { cn } from "@lib/utils";
import { useCapabilities, useStreamReader, useStreamState } from "@stores";
import { formatRate } from "@xbond/client/activity";
import { formatTraffic } from "@xbond/client/helper";
import type { Snapshot } from "@xbond/client/request";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

export default function Activity() {
  const { t: sb } = useTranslation("sidebar");
  const { t: r } = useTranslation("runtime");
  const { t: ov } = useTranslation("overview");
  const caps = useCapabilities();
  const [params, setParams] = useSearchParams();
  const activeTab =
    params.get("view") === "connections" ? "connections" : "logs";
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
  function select(view: string) {
    setParams(
      (previous) => {
        previous.set("view", view);
        return previous;
      },
      { replace: true },
    );
  }
  return (
    <div className="page gap-[22px]">
      <Header title={sb("activity")}>
        <output>{r(state)}</output>
      </Header>
      <dl className="flex flex-wrap gap-x-10 gap-y-7 rounded-card border border-border bg-card p-6 max-md:gap-x-7 max-md:gap-y-[22px]">
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("upload")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.up) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("download")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.down) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{sb("connections")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {connectionState === "open"
              ? (snapshot?.connections.length ?? "—")
              : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("total")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {connectionState === "open" && snapshot
              ? formatTraffic(snapshot.uploadTotal + snapshot.downloadTotal)
              : "—"}
          </dd>
        </div>
        {caps.memory && (
          <div className="flex flex-col gap-2.5">
            <dt className="text-xs text-muted-foreground">{ov("memory")}</dt>
            <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
              {memoryBytes === null ? "—" : formatTraffic(memoryBytes)}
            </dd>
          </div>
        )}
      </dl>
      <div
        className="flex max-md:w-full w-fit gap-1 rounded-xl border border-border bg-inset p-1"
        role="tablist"
        aria-label={sb("activity")}
      >
        {(["logs", "connections"] as const).map((view) => (
          <button
            type="button"
            key={view}
            id={"tab-" + view}
            role="tab"
            aria-controls={"panel-" + view}
            aria-selected={activeTab === view}
            tabIndex={activeTab === view ? 0 : -1}
            className={cn(
              "rounded-lg px-[22px] py-2 text-body font-medium transition-colors duration-150 max-md:min-h-11 max-md:flex-1 motion-reduce:transition-none",
              activeTab === view
                ? "bg-brand font-semibold text-brand-foreground shadow-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => select(view)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "logs"
                    : event.key === "End"
                      ? "connections"
                      : view === "logs"
                        ? "connections"
                        : "logs";
                select(next);
                document.getElementById("tab-" + next)?.focus();
              }
            }}
          >
            {sb(view === "logs" ? "logs" : "connections")}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/rules">{sb("rules")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/diagnostics">{sb("diagnostics")}</Link>
        </Button>
      </div>
      <div className="min-w-0 w-full min-h-0 flex-1 [&_[role=tabpanel]]:h-full [&_.page]:p-0 [&_.page]:gap-3 [&_.page]:h-full [&_.page]:min-h-0 [&_.header]:m-0 [&_.header]:flex-wrap [&_.header]:gap-3 [&_.header_h1]:text-base [&_.connections-filter]:max-md:ml-0 [&_.connections-card]:max-md:min-h-[360px] [&_.log-table]:overflow-hidden [&_.log-table]:rounded-xl">
        <div
          id="panel-logs"
          role="tabpanel"
          aria-labelledby="tab-logs"
          hidden={activeTab !== "logs"}
        >
          <Logs />
        </div>
        <div
          id="panel-connections"
          role="tabpanel"
          aria-labelledby="tab-connections"
          hidden={activeTab !== "connections"}
        >
          <Connections />
        </div>
      </div>
    </div>
  );
}
