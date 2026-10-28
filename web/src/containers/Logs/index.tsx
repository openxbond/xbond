import { Select, Card, Header, Button, Input, EmptyState } from "@components";
import type { Log } from "@models/Log";
import {
  useConfig,
  useGeneral,
  useLogsStreamReader,
  useStreamState,
} from "@stores";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  List,
  type RowComponentProps,
  type ListImperativeAPI,
} from "react-window";

import "./style.scss";

const levels = ["", "debug", "info", "warning", "error", "silent"];
function LogRow({ index, style, logs }: RowComponentProps<{ logs: Log[] }>) {
  const log = logs[index];
  const tone =
    (
      {
        warning: "text-warning",
        warn: "text-warning",
        error: "text-destructive",
        info: "text-info",
      } as Record<string, string>
    )[log.type] ?? "text-muted-foreground";
  return (
    <div style={style} className="log-data-row" title={log.payload}>
      <span className="mr-3 tabular-nums text-muted-foreground">
        {dayjs(log.time).format("YYYY-MM-DD HH:mm:ss")}
      </span>
      <span className={tone}>[{log.type.toUpperCase()}]</span>
      <span className="log-message">{log.payload}</span>
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
  const reader = useLogsStreamReader();
  const state = useStreamState(reader);
  const [logs, setLogs] = useState<Log[]>([]);
  const buffer = useRef<Log[]>([]);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const [search, setSearch] = useState("");
  const list = useRef<ListImperativeAPI | null>(null);
  const follow = useRef(true);
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
      ].slice(-1000);
      if (!pauseRef.current) setLogs(buffer.current);
    };
    reader.subscribe("data", onData);
    return () => reader.unsubscribe("data", onData);
  }, [reader]);
  useEffect(() => {
    if (follow.current && filtered.length)
      list.current?.scrollToRow({ index: filtered.length - 1, align: "end" });
  }, [filtered]);
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
          {logLevel === "silent" || general.logLevel === "silent"
            ? t("silent")
            : r(state)}
        </output>
      </Header>
      <div className="my-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t("levelLabel")}
          <Select
            value={logLevel ?? ""}
            options={levels.map((level) => ({
              value: level,
              label: level === "silent" ? t("silent") : level || "Default",
            }))}
            onSelect={(level) => set("logLevel", level)}
            disabled={general.logLevel?.toLowerCase() === "silent"}
          />
        </label>
        <Input
          aria-label={t("filterLogs")}
          placeholder={t("filterLogs")}
          value={search}
          onChange={setSearch}
          align="left"
          className="min-w-40 flex-1"
        />
        <Button onClick={togglePause}>
          {paused ? t("resume") : t("paused")}
        </Button>
        <Button
          onClick={() => {
            follow.current = true;
            if (filtered.length)
              list.current?.scrollToRow({
                index: filtered.length - 1,
                align: "end",
              });
          }}
        >
          {t("follow")}
        </Button>
        <Button onClick={clear}>{tc("clear")}</Button>
        <Button disabled={!filtered.length} onClick={download}>
          {t("export")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("logLimit")}</span>
      </div>
      <Card className="log-table min-h-80 flex flex-1 flex-col p-0">
        {filtered.length ? (
          <>
            <div className="table-header log-header">
              <span>{t("columns.time")}</span>
              <span>{t("columns.level")}</span>
              <span>{t("columns.message")}</span>
            </div>
            {/* CSS-only bounds: the box's height comes from flex layout
                (basis 0), never from content, so the list can never grow to
                render the whole buffer. No JS measurement in the loop. */}
            <div className="log-list-box">
              <List
                listRef={list}
                rowCount={filtered.length}
                rowHeight={34}
                rowComponent={LogRow}
                rowProps={{ logs: filtered }}
                style={{
                  height: "100%",
                  width: "100%",
                  overflow: "auto",
                }}
                onScroll={() => {
                  const el = list.current?.element;
                  if (el)
                    follow.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 90;
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
