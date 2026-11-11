import { useMediaQuery } from "@react-hookz/web";
import dayjs from "dayjs";
import { ArrowDownToLine, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  List,
  type RowComponentProps,
  type ListImperativeAPI,
} from "react-window";
import useSWR from "swr";

import { CompactSearch } from "@/components/compact-search";
import {
  DisconnectedState,
  useIsServiceConnected,
} from "@/components/disconnected-state";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStreamReader, useStreamState } from "@/hooks/use-core-stream";
import { cn } from "@/lib/utils";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";
import { useConfig } from "@/state/user-preferences";

import type { Log } from "./log-entry";

const levels = ["", "debug", "info", "warning", "error", "silent"];
const logLimit = 1000;
// Header cells and rows share these widths so columns stay aligned. Narrow
// viewports drop the date part: a 180px column starves the message column.
const wideTimeColumnWidth = 180;
const levelColumnWidth = 75;
// Radix Select items reject empty strings, so the level "" (Default) is
// carried by this sentinel and parsed back on change.
const defaultLevel = "__default__";
function LogRow({
  index,
  style,
  logs,
  compact,
}: RowComponentProps<{ logs: Log[]; compact: boolean }>) {
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
  if (compact) {
    // 移動端緊湊：時間 + 級別徽章在上，正文支援多行自然換行或完整顯示，
    // 點擊複製整條日誌，不再硬性單行截斷。
    return (
      <div
        style={style}
        className="flex w-full select-text flex-col justify-center gap-1 border-b border-border/60 px-3.5 py-1.5 transition-colors hover:bg-inset/40"
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {dayjs(log.time).format("HH:mm:ss")}
          </span>
          <span
            className={cn(
              "shrink-0 rounded bg-inset px-1.5 py-px font-mono text-xs font-semibold uppercase",
              tone,
            )}
          >
            {log.type}
          </span>
        </div>
        <span
          className="font-mono text-xs text-foreground line-clamp-2 leading-relaxed break-all select-text"
          title={log.payload}
        >
          {log.payload}
        </span>
      </div>
    );
  }
  return (
    // 與連接頁同構：無 flex gap 的定寬單元格（內距在格內），時間＋級別
    // sticky 帶實底——橫滾時行首上下文不丟，正文從底下穿過無縫隙漏字。
    <div
      style={style}
      className="flex w-max! min-w-full select-text items-center border-b border-border font-mono text-xs whitespace-nowrap"
      title={log.payload}
    >
      <span
        className="sticky left-0 z-10 shrink-0 bg-card pl-4 pr-3 tabular-nums text-muted-foreground"
        style={{ width: wideTimeColumnWidth + 28 }}
      >
        {dayjs(log.time).format("YYYY-MM-DD HH:mm:ss")}
      </span>
      <span
        className={cn("sticky left-0 z-10 shrink-0 bg-card", tone)}
        style={{
          width: levelColumnWidth + 16,
          left: wideTimeColumnWidth + 28,
        }}
      >
        [{log.type.toUpperCase()}]
      </span>
      <span className="pr-6">{log.payload}</span>
    </div>
  );
}
export default function Logs({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation("logs");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const {
    data: { logLevel },
    set,
  } = useConfig();
  const { general } = useGeneral();
  const { isConnected } = useIsServiceConnected();
  // Below the compact breakpoint the log table drops the date part of the
  // timestamp so the message column keeps usable width.
  const compact = (useMediaQuery("(max-width: 767px)") ?? false) === true;
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
  const headerRef = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  // Entries that arrived while the user scrolled away from the bottom;
  // surfaced by the "back to latest" pill instead of stealing the viewport.
  const [newCount, setNewCount] = useState(0);
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
      if (!pauseRef.current) {
        if (!follow.current) setNewCount((count) => count + entries.length);
        setLogs(buffer.current);
      }
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
    if (!pauseRef.current) {
      if (!follow.current) setNewCount((count) => count + entries.length);
      setLogs(buffer.current);
    }
  }, [client, recent.data]);
  const followLatest = useCallback(() => {
    const element = list.current?.element;
    if (follow.current && element) element.scrollTop = element.scrollHeight;
  }, []);
  function backToLatest() {
    follow.current = true;
    setFollowing(true);
    setNewCount(0);
    followLatest();
  }
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

  if (!isConnected) {
    return (
      <div className="page logs-page">
        {!embedded && <Header title={t("title")} />}
        <DisconnectedState description={t("disconnectedNotice")} />
      </div>
    );
  }

  return (
    <div className="page logs-page">
      {/* 嵌入移動端「動態」分頁時由宿主供頁標題。 */}
      {!embedded && (
        <Header title={t("title")}>
          <output className="inline-flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
            <span className={cn("status-dot", state === "open" && "online")} />
            {silent ? t("silent") : r(state)}
          </output>
        </Header>
      )}
      <div className="page-toolbar items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("levelLabel")}
          <Select
            value={logLevel || defaultLevel}
            onValueChange={(next) =>
              set("logLevel", next === defaultLevel ? "" : next)
            }
            disabled={general.logLevel?.toLowerCase() === "silent"}
          >
            <SelectTrigger
              aria-label={t("levelLabel")}
              size="sm"
              className="rounded-xl"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {levels.map((level) => (
                  <SelectItem
                    key={level}
                    value={level === "" ? defaultLevel : level}
                  >
                    {level === "silent"
                      ? t("silent")
                      : level || t("levelDefault")}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        <CompactSearch
          className="min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-md"
          value={search}
          onValueChange={setSearch}
          placeholder={t("filterLogs")}
          ariaLabel={t("filterLogs")}
          clearLabel={tc("clear")}
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={paused}
          className="aria-pressed:bg-inset aria-pressed:text-foreground"
          onClick={togglePause}
        >
          {paused ? t("resume") : t("paused")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!filtered.length}
          onClick={clear}
        >
          {tc("clear")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!filtered.length}
          onClick={download}
        >
          {t("export")}
        </Button>
        <span className="ms-auto text-caption text-muted-foreground">
          {t("logLimit")}
        </span>
      </div>
      <Card className="log-table overflow-hidden min-h-80 flex flex-1 flex-col p-0">
        {filtered.length ? (
          <>
            {!compact && (
              <div className="table-header flex shrink-0 items-center px-0">
                <span
                  className="shrink-0 pl-4 pr-3"
                  style={{ width: wideTimeColumnWidth + 28 }}
                >
                  {t("columns.time")}
                </span>
                <span
                  className="shrink-0 pr-4"
                  style={{ width: levelColumnWidth + 16 }}
                >
                  {t("columns.level")}
                </span>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div ref={headerRef}>
                    <span className="block whitespace-nowrap">
                      {t("columns.message")}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {/* Keep the list spacer out of the viewport's sizing. */}
            <div className="relative min-h-[320px] flex-1 overflow-hidden">
              <List
                listRef={list}
                rowCount={filtered.length}
                rowHeight={compact ? 74 : 34}
                rowComponent={LogRow}
                rowProps={{ logs: filtered, compact }}
                onResize={followLatest}
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "auto",
                }}
                onScroll={() => {
                  const el = list.current?.element;
                  if (!el) return;
                  // Rows scroll horizontally under a header that lives
                  // outside the scroller; shift it to keep columns aligned.
                  if (headerRef.current) {
                    headerRef.current.style.transform = `translateX(${-el.scrollLeft}px)`;
                  }
                  const next =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                  if (next !== follow.current) {
                    follow.current = next;
                    setFollowing(next);
                    if (next) setNewCount(0);
                  }
                }}
              />
              {/* Scrolled away from the bottom: offer the way back instead of
                  yanking the viewport (spec: 返回最新 + 新记录数). */}
              {!following && (
                <button
                  type="button"
                  className="absolute right-4 bottom-4 z-10 inline-flex animate-in cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-card/90 py-1.5 pr-3.5 pl-3 text-xs font-medium text-brand-text shadow-elevation-raised backdrop-blur-xs fade-in slide-in-from-bottom-2 duration-200 hover:bg-card"
                  onClick={backToLatest}
                >
                  <ArrowDownToLine aria-hidden="true" className="size-3.5" />
                  {newCount > 0
                    ? t("newLogs", { count: newCount })
                    : t("follow")}
                </button>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            className="min-h-80 flex-1"
            icon={
              <ScrollText
                aria-hidden="true"
                className="size-7 text-muted-foreground/50"
              />
            }
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
