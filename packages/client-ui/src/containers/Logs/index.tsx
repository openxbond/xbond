import { Card, Header, Button, Input, EmptyState } from "@components";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@lib/utils";
import type { Log } from "@models/Log";
import {
  useConfig,
  useGeneral,
  useLocalAPI,
  useStreamReader,
  useStreamState,
} from "@stores";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  List,
  type RowComponentProps,
  type ListImperativeAPI,
} from "react-window";
import useSWR from "swr";

const levels = ["", "debug", "info", "warning", "error", "silent"];
const logLimit = 1000;
// Radix Select items reject empty strings, so the level "" (Default) is
// carried by this sentinel and parsed back on change.
const defaultLevel = "__default__";
function LogRow({ index, style, logs }: RowComponentProps<{ logs: Log[] }>) {
  const log = logs[index];
  const tone =
    (
      {
        warning: "text-warning-text",
        warn: "text-warning-text",
        error: "text-destructive-text",
        info: "text-info",
      } as Record<string, string>
    )[log.type] ?? "text-muted-foreground";
  return (
    <div
      style={style}
      className="log-data-row flex w-max! min-w-full items-center gap-4 border-b border-border px-4 font-mono text-xs whitespace-nowrap"
      title={log.payload}
    >
      <span className="mr-3 w-[180px] shrink-0 tabular-nums text-muted-foreground">
        {dayjs(log.time).format("YYYY-MM-DD HH:mm:ss")}
      </span>
      <span className={cn("w-[75px] shrink-0", tone)}>
        [{log.type.toUpperCase()}]
      </span>
      <span className="log-message pr-6">{log.payload}</span>
    </div>
  );
}
export default function Logs() {
  const { t } = useTranslation("logs");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const {
    data: { logLevel },
    set,
  } = useConfig();
  const { general } = useGeneral();
  const level = logLevel || general.logLevel || "info";
  const silent = level === "silent" || general.logLevel === "silent";
  const {
    daemonClient: client,
    config,
    daemonState,
    isLocalTarget,
  } = useLocalAPI();
  const reader = useStreamReader<Log>(
    isLocalTarget || silent ? null : `logs?level=${level}`,
  );
  const streamState = useStreamState(reader);
  const logLevelForDaemon = level === "warning" ? "warn" : level;
  const recent = useSWR(
    isLocalTarget && client && config && !silent
      ? ["/localapi/v0/logs", config.endpoint, config.token, logLevelForDaemon]
      : null,
    () => client?.getLogs(logLevelForDaemon, logLimit),
    { refreshInterval: 1000, dedupingInterval: 500 },
  );
  const state = isLocalTarget
    ? recent.error
      ? "reconnecting"
      : recent.data
        ? "open"
        : daemonState === "offline"
          ? "closed"
          : "connecting"
    : streamState;
  const [logs, setLogs] = useState<Log[]>([]);
  const buffer = useRef<Log[]>([]);
  const daemonCursor = useRef<{ client: typeof client; seq: number } | null>(
    null,
  );
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const [search, setSearch] = useState("");
  const list = useRef<ListImperativeAPI | null>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          !search || log.payload.toLowerCase().includes(search.toLowerCase()),
      ),
    [logs, search],
  );
  useEffect(() => {
    const onData = (entries: Log[]) => {
      buffer.current = [
        ...buffer.current,
        ...entries.map((log) => ({ ...log, time: new Date() })),
      ].slice(-logLimit);
      if (!pauseRef.current) setLogs(buffer.current);
    };
    reader.subscribe("data", onData);
    return () => reader.unsubscribe("data", onData);
  }, [reader]);
  useEffect(() => {
    if (!client || !recent.data?.length) return;
    const cursor = daemonCursor.current;
    const entries =
      cursor?.client === client
        ? recent.data.filter((entry) => entry.seq > cursor.seq)
        : recent.data;
    const last = entries.at(-1);
    if (!last) return;
    // A cleared row stays cleared even when the next snapshot contains it.
    daemonCursor.current = { client, seq: last.seq };
    buffer.current = [
      ...buffer.current,
      ...entries.map(({ timestamp, level, message }) => ({
        time: new Date(timestamp),
        type: level,
        payload: message,
      })),
    ].slice(-logLimit);
    if (!pauseRef.current) setLogs(buffer.current);
  }, [client, recent.data]);
  const followLatest = useCallback(() => {
    const element = list.current?.element;
    if (follow.current && element) element.scrollTop = element.scrollHeight;
  }, []);
  useEffect(followLatest, [filtered, followLatest]);
  function togglePause() {
    pauseRef.current = !pauseRef.current;
    setPaused(pauseRef.current);
    if (!pauseRef.current) setLogs(buffer.current);
  }
  function clear() {
    buffer.current = [];
    reader.clear();
    setLogs([]);
  }
  function download() {
    const text = filtered
      .map(
        (log) =>
          `${dayjs(log.time).format("YYYY-MM-DD HH:mm:ss")} [${log.type}] ${log.payload}`,
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "dashboard-logs.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="page logs-page">
      <Header title={t("title")}>
        <output className="text-sm text-muted-foreground">
          {silent ? t("silent") : r(state)}
        </output>
      </Header>
      <div className="page-toolbar">
        <label className="flex items-center gap-2 text-sm">
          {t("levelLabel")}
          <Select
            value={logLevel || defaultLevel}
            onValueChange={(next) =>
              set("logLevel", next === defaultLevel ? "" : next)
            }
            disabled={general.logLevel?.toLowerCase() === "silent"}
          >
            <SelectTrigger aria-label={t("levelLabel")} className="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {levels.map((level) => (
                  <SelectItem
                    key={level}
                    value={level === "" ? defaultLevel : level}
                  >
                    {level === "silent" ? t("silent") : level || "Default"}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <Input
          aria-label={t("filterLogs")}
          placeholder={t("filterLogs")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-40 flex-1 text-left"
        />
        <Button variant="outline" onClick={togglePause}>
          {paused ? t("resume") : t("paused")}
        </Button>
        <Button
          aria-pressed={following}
          className="aria-pressed:bg-brand aria-pressed:text-brand-foreground aria-pressed:hover:bg-brand-strong"
          onClick={() => {
            follow.current = true;
            setFollowing(true);
            followLatest();
          }}
        >
          {t("follow")}
        </Button>
        <Button variant="outline" onClick={clear}>
          {tc("clear")}
        </Button>
        <Button
          variant="outline"
          disabled={!filtered.length}
          onClick={download}
        >
          {t("export")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("logLimit")}</span>
      </div>
      <Card className="log-table overflow-hidden min-h-80 flex flex-1 flex-col p-0">
        {filtered.length ? (
          <>
            <div className="table-header log-header flex shrink-0 items-center gap-4 px-4">
              <span className="mr-3 w-[180px] shrink-0">
                {t("columns.time")}
              </span>
              <span className="w-[75px] shrink-0">{t("columns.level")}</span>
              <span>{t("columns.message")}</span>
            </div>
            {/* Keep the list spacer out of the viewport's sizing. */}
            <div className="log-list-box relative min-h-[320px] flex-1 overflow-hidden">
              <List
                listRef={list}
                rowCount={filtered.length}
                rowHeight={34}
                rowComponent={LogRow}
                rowProps={{ logs: filtered }}
                onResize={followLatest}
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "auto",
                }}
                onScroll={() => {
                  const el = list.current?.element;
                  if (!el) return;
                  const next =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                  if (next !== follow.current) {
                    follow.current = next;
                    setFollowing(next);
                  }
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState
            className="min-h-80 flex-1"
            message={search ? tc("empty") : t("empty")}
            action={
              !search && (
                <button
                  className="empty-state-action"
                  onClick={() => set("logLevel", "debug")}
                >
                  {t("emptyAction")}
                </button>
              )
            }
          />
        )}
      </Card>
    </div>
  );
}
