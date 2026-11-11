import { useIntersectionObserver, useSyncedRef } from "@react-hookz/web";
import {
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { basePath, formatTraffic } from "@xbond/client/helper";
import type * as API from "@xbond/client/request";
import { ArrowDown, ArrowLeftRight, ArrowUp, Unplug, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { groupBy } from "remeda";
import { toast } from "sonner";

import {
  DisconnectedState,
  useIsServiceConnected,
} from "@/components/disconnected-state";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/page-header";
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
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useObject, useVisible } from "@/hooks/react-state";
import { useAction } from "@/hooks/use-action";
import {
  useConnectionStreamReader,
  useStreamState,
} from "@/hooks/use-core-stream";
import { fromNow } from "@/i18n/relative-time";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/platform/host";
import { useClient } from "@/state/controller-target";
import { useLanguage } from "@/state/user-preferences";

import { ConnectionInfo } from "./connection-details";
import { Devices } from "./connection-device-filter";
import {
  type Connection,
  type FormatConnection,
  useConnections,
} from "./use-connections";

const Columns = {
  Host: "host",
  Network: "network",
  Process: "process",
  Type: "type",
  Chains: "chains",
  Rule: "rule",
  Speed: "speed",
  Upload: "upload",
  Download: "download",
  SourceIP: "sourceIP",
  Time: "time",
} as const;

// Numbers read right-aligned; short enums stay centered; everything else
// (hosts, chains, rules, paths, timestamps) reads left-aligned.
const columnAlignments: Partial<
  Record<string, "text-left" | "text-center" | "text-right">
> = {
  [Columns.Network]: "text-center",
  [Columns.Type]: "text-center",
  [Columns.Speed]: "text-center",
  [Columns.Upload]: "text-right",
  [Columns.Download]: "text-right",
};
const alignClass = (id: string) => columnAlignments[id] ?? "text-left";

// Inset hairline marking the sticky host column once the table scrolls under it.
const stickyShadow =
  "shadow-[inset_-9px_0_8px_-14px_color-mix(in_srgb,var(--foreground)_45%,transparent)]";

// Live rate cell: direction arrows carry the upload/download roles, matching
// the header traffic capsule.
function SpeedCell({ upload, download }: { upload: number; download: number }) {
  if (upload === 0 && download === 0) return "-";
  return (
    <span className="inline-flex items-center justify-center gap-1.5 text-label">
      {upload !== 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp aria-hidden="true" className="size-3" />
          {formatTraffic(upload)}/s
        </span>
      )}
      {download !== 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowDown aria-hidden="true" className="size-3" />
          {formatTraffic(download)}/s
        </span>
      )}
    </span>
  );
}

const columnHelper = createColumnHelper<FormatConnection>();

const filterFields = {
  host: "filterHost",
  process: "filterProcess",
  rule: "filterRule",
  chains: "filterChain",
} as const;

// Mobile card stream cap: a flat list keeps first-render cheap; older rows
// are reachable by narrowing the search instead of unbounded DOM growth.
const MOBILE_CARD_LIMIT = 200;

/** 移動端雙行連接卡片：首行目標與實時下行速率，次行協議、命中規則與累計流量。 */
function ConnectionCard({
  row,
  onOpen,
}: {
  row: FormatConnection;
  onOpen: () => void;
}) {
  const { t } = useTranslation("connections");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={row.host}
        className={cn(
          "w-full max-md:min-h-11 cursor-pointer rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-start",
          "transition-colors duration-150 hover:border-brand/40 active:bg-inset/70",
          row.completed && "bg-inset/50 text-muted-foreground",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">
            {row.host}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-caption tabular-nums text-muted-foreground">
            <ArrowDown aria-hidden="true" className="size-3" />
            {formatTraffic(row.speed.download)}/s
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
          <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 font-mono text-caption">
            {row.network}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {row.rule} → {row.chains}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"
            title={t("info.title")}
          >
            <span aria-hidden="true" className="inline-flex items-center">
              <ArrowUp className="size-3" />
              <ArrowDown className="size-3" />
            </span>
            {formatTraffic(row.upload + row.download)}
          </span>
        </div>
      </button>
    </li>
  );
}

export default function Connections({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation("connections");
  const { lang } = useLanguage();
  const connStreamReader = useConnectionStreamReader();
  const streamState = useStreamState(connStreamReader);
  const { run, pending } = useAction();
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const [closeFiltered, setCloseFiltered] = useState(false);
  const [filters, setFilters] = useObject({
    host: "",
    process: "",
    rule: "",
    chains: "",
  });
  const client = useClient();
  const { isConnected } = useIsServiceConnected();

  // total
  const [traffic, setTraffic] = useObject({
    uploadTotal: 0,
    downloadTotal: 0,
  });

  // close all connections
  const { visible, show, hide } = useVisible();
  const closeTrigger = useRef<HTMLButtonElement>(null);
  function handleCloseConnections() {
    void run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      if (closeFiltered) {
        const ids = instance
          .getFilteredRowModel()
          .rows.filter((row) => !row.original.completed)
          .map((row) => row.original.id);
        // 逐批關閉：數千條連線同時打向核心會過載，且部分失敗需要
        // 如實回報已完成數量，不能整體靜默。
        const concurrency = 8;
        let index = 0;
        let closed = 0;
        await Promise.all(
          Array.from(
            { length: Math.min(concurrency, ids.length) },
            async () => {
              while (index < ids.length) {
                const id = ids[index++];
                try {
                  await client.closeConnection(id);
                  closed += 1;
                } catch {
                  /* 單條失敗計入配額回報，不中斷其餘關閉。 */
                }
              }
            },
          ),
        );
        if (closed < ids.length)
          toast.error(t("closePartial", { closed, total: ids.length }), {
            duration: 6000,
          });
        else toast.success(t("closeDone", { count: closed }));
      } else await client.closeAllConnections();
      hide();
    }, false);
  }

  // connections
  const { connections, feed, save, toggleSave, clearClosed, resetRate } =
    useConnections();
  useEffect(() => {
    if (streamState !== "open") resetRate();
  }, [streamState, resetRate]);
  const data: FormatConnection[] = useMemo(
    () =>
      connections.map((c) => ({
        id: c.id,
        host: `${c.metadata.host || c.metadata.destinationIP}:${c.metadata.destinationPort}`,
        chains: c.chains.slice().reverse().join(" / "),
        rule: c.rulePayload ? `${c.rule} :: ${c.rulePayload}` : c.rule,
        time: new Date(c.start).getTime(),
        upload: c.upload,
        download: c.download,
        sourceIP: c.metadata.sourceIP,
        type: c.metadata.type,
        network: c.metadata.network.toUpperCase(),
        process: c.metadata.processPath,
        speed: { upload: c.uploadSpeed, download: c.downloadSpeed },
        completed: !!c.completed,
        original: c,
      })),
    [connections],
  );
  const devices = useMemo(() => {
    const gb = groupBy(connections, (c) => c.metadata.sourceIP);
    return Object.keys(gb)
      .map((key) => ({ label: key, number: gb[key].length }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [connections]);

  // Process paths are static per connection, so an all-empty column can be
  // hidden. Speed is live data that comes and goes with traffic — its column
  // always stays, showing "-" for idle rows.
  const hasProcess = data.some((row) => row.process);

  // table
  const pinRef = useRef<HTMLDivElement>(null);
  const intersection = useIntersectionObserver(pinRef, { threshold: [1] });
  const columns = useMemo(
    () => [
      columnHelper.accessor(Columns.Host, {
        minSize: 260,
        size: 260,
        header: t(`columns.${Columns.Host}`),
      }),
      columnHelper.accessor(Columns.Network, {
        minSize: 80,
        size: 80,
        header: t(`columns.${Columns.Network}`),
      }),
      columnHelper.accessor(Columns.Type, {
        minSize: 110,
        size: 110,
        header: t(`columns.${Columns.Type}`),
        cell: (cell) => <span title={cell.getValue()}>{cell.getValue()}</span>,
      }),
      columnHelper.accessor(Columns.Chains, {
        minSize: 240,
        size: 240,
        header: t(`columns.${Columns.Chains}`),
      }),
      columnHelper.accessor(Columns.Rule, {
        minSize: 150,
        size: 150,
        header: t(`columns.${Columns.Rule}`),
      }),
      ...(hasProcess
        ? [
            columnHelper.accessor(Columns.Process, {
              minSize: 90,
              size: 90,
              header: t(`columns.${Columns.Process}`),
              cell: (cell) =>
                cell.getValue() ? basePath(cell.getValue()!) : "-",
            }),
          ]
        : []),
      columnHelper.accessor((row) => [row.speed.upload, row.speed.download], {
        id: Columns.Speed,
        header: t(`columns.${Columns.Speed}`),
        minSize: 200,
        size: 200,
        sortDescFirst: true,
        sortingFn(rowA, rowB) {
          const speedA = rowA.original?.speed ?? {
            upload: 0,
            download: 0,
          };
          const speedB = rowB.original?.speed ?? {
            upload: 0,
            download: 0,
          };
          return speedA.download === speedB.download
            ? speedA.upload - speedB.upload
            : speedA.download - speedB.download;
        },
        cell: (cell) => (
          <SpeedCell
            upload={cell.getValue()[0]}
            download={cell.getValue()[1]}
          />
        ),
      }),
      columnHelper.accessor(Columns.Upload, {
        minSize: 90,
        size: 90,
        header: t(`columns.${Columns.Upload}`),
        cell: (cell) => formatTraffic(cell.getValue()),
      }),
      columnHelper.accessor(Columns.Download, {
        minSize: 90,
        size: 90,
        header: t(`columns.${Columns.Download}`),
        cell: (cell) => formatTraffic(cell.getValue()),
      }),
      columnHelper.accessor(Columns.SourceIP, {
        minSize: 170,
        size: 170,
        header: t(`columns.${Columns.SourceIP}`),
        filterFn: "equals",
      }),
      columnHelper.accessor(Columns.Time, {
        minSize: 100,
        size: 100,
        header: t(`columns.${Columns.Time}`),
        cell: (cell) => fromNow(new Date(cell.getValue()), lang),
        sortingFn: (rowA, rowB) =>
          (rowB.original?.time ?? 0) - (rowA.original?.time ?? 0),
      }),
    ],
    [lang, t, hasProcess],
  );

  useLayoutEffect(() => {
    function handleConnection(snapshots: API.Snapshot[]) {
      for (const snapshot of snapshots) {
        setTraffic({
          uploadTotal: snapshot.uploadTotal,
          downloadTotal: snapshot.downloadTotal,
        });

        feed(snapshot.connections);
      }
    }

    connStreamReader?.subscribe("data", handleConnection);
    return () => {
      connStreamReader?.unsubscribe("data", handleConnection);
    };
  }, [connStreamReader, feed, setTraffic]);

  const [device, setDevice] = useState("");
  const isMobileViewport = useIsMobile();
  const cardMode = mobile || isMobileViewport;
  const [mobileQuery, setMobileQuery] = useState("");
  const mobileRows = useMemo(() => {
    const q = mobileQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (row) =>
        row.host.toLowerCase().includes(q) ||
        (row.process ?? "").toLowerCase().includes(q) ||
        row.rule.toLowerCase().includes(q) ||
        row.chains.toLowerCase().includes(q),
    );
  }, [data, mobileQuery]);
  const columnFilters = useMemo(
    () => [
      ...Object.entries(filters)
        .filter(([, value]) => value.trim())
        .map(([id, value]) => ({ id, value: value.trim() })),
      ...(device ? [{ id: Columns.SourceIP, value: device }] : []),
    ],
    [filters, device],
  );
  // 列寬預算（size 與 minSize 相同）合計 1580px，1280 預設視口的表格
  // 容器只有約 990px——此前的 767px 讓位斷點遠低於實際溢出區間，中間
  // 全部橫向滾動、速率列攔腰截斷。改為容器實測寬度驅動的低優先級列
  // 階梯讓位：可見列永遠完整，不完整的寬度下寧可少列。
  // 表格容器隨數據流到達才掛載：用回調 ref 保證觀察器在真實掛載時接上。
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const tableScrollRef = useCallback(
    (el: HTMLDivElement | null) => setScrollEl(el),
    [],
  );
  const [tableWidth, setTableWidth] = useState(0);
  useEffect(() => {
    if (!scrollEl) return;
    const update = () => setTableWidth(scrollEl.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);
  const instance = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: {
      sorting: [{ id: Columns.Time, desc: false }],
    },
    state: {
      columnFilters,
      columnVisibility: {
        time: tableWidth >= 1590,
        sourceIP: tableWidth >= 1490,
        upload: tableWidth >= 1320,
        download: tableWidth >= 1320,
        process: tableWidth >= 1140,
        rule: tableWidth >= 1050,
        type: tableWidth >= 900,
        network: tableWidth >= 790,
      },
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
  });

  const headerGroup = instance.getHeaderGroups()[0];

  // filter
  function handleDeviceSelected(label: string) {
    setDevice(label);
  }

  // click item
  const [drawerState, setDrawerState] = useObject({
    visible: false,
    selectedID: "",
    connection: {} as Partial<Connection>,
  });
  function handleConnectionClosed() {
    void run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      await client.closeConnection(drawerState.selectedID);
    }, false);
  }
  const latestConntion = useSyncedRef(drawerState.connection);
  useEffect(() => {
    const conn = data.find((c) => c.id === drawerState.selectedID)?.original;
    if (conn) {
      setDrawerState((d) => {
        d.connection = { ...conn };
      });
    } else if (
      Object.keys(latestConntion.current).length !== 0 &&
      !latestConntion.current.completed
    ) {
      setDrawerState((d) => {
        d.connection.completed = true;
      });
    }
  }, [data, drawerState.selectedID, latestConntion, setDrawerState]);

  const scrolled = useMemo(
    () => (intersection?.intersectionRatio ?? 0) < 1,
    [intersection],
  );
  const visibleLeafIds = instance.getVisibleLeafColumns().map((c) => c.id);
  const lastVisibleId = visibleLeafIds[visibleLeafIds.length - 1];
  const headers = headerGroup.headers.map((header, idx) => {
    const column = header.column;
    const id = column.id;
    const isHost = column.id === Columns.Host;
    return (
      <div
        role="columnheader"
        aria-sort={
          column.getCanSort()
            ? column.getIsSorted() === "asc"
              ? "ascending"
              : column.getIsSorted() === "desc"
                ? "descending"
                : "none"
            : undefined
        }
        className={cn(
          "table-header relative inline-block h-8 min-w-0 shrink-0 overflow-hidden px-3.5 text-ellipsis whitespace-nowrap leading-8",
          alignClass(id),
          isHost && "sticky left-[-0.1px] z-10",
          scrolled && isHost && stickyShadow,
        )}
        style={{
          flex: `${header.getSize()} ${id === lastVisibleId ? 1 : 0} ${header.getSize()}px`,
        }}
        ref={isHost ? pinRef : undefined}
        key={id}
      >
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-0.5 bg-transparent font-[inherit] text-[inherit]"
          onClick={column.getToggleSortingHandler()}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          {column.getIsSorted() === "asc" && (
            <ArrowUp aria-hidden="true" className="size-3 shrink-0" />
          )}
          {column.getIsSorted() === "desc" && (
            <ArrowDown aria-hidden="true" className="size-3 shrink-0" />
          )}
        </button>
        {idx !== headerGroup.headers.length - 1 && (
          <div
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            className={cn(
              "absolute inset-y-2 -right-2.5 z-10 w-5 cursor-col-resize text-sm font-light opacity-0 touch-none transition-opacity duration-200",
              "before:absolute before:left-2.5 before:h-full before:w-0.5 before:-translate-x-px before:bg-[color-mix(in_srgb,var(--foreground)_30%,transparent)] before:content-['']",
              "group-hover:opacity-100",
              column.getIsResizing() && "cursor-col-resize opacity-100",
            )}
          />
        )}
      </div>
    );
  });

  const [scrollStart, setScrollStart] = useState(0);
  const rows = instance.getRowModel().rows;
  const start = Math.min(scrollStart, Math.max(0, rows.length - 80));
  const end = Math.min(rows.length, start + 80);
  const content = rows.slice(start, end).map((row) => {
    const selected = row.original?.id === drawerState.selectedID;
    return (
      <div
        role="row"
        tabIndex={0}
        className="group flex h-9.25 cursor-pointer select-none transition-colors duration-150 focus-visible:bg-row-hover"
        key={row.original?.id}
        onClick={() =>
          setDrawerState({
            visible: true,
            selectedID: row.original?.id,
          })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDrawerState({
              visible: true,
              selectedID: row.original?.id,
            });
          }
        }}
      >
        {row.getVisibleCells().map((cell) => {
          const size = cell.column.getSize();
          const monospace =
            cell.column.id === Columns.Host ||
            cell.column.id === Columns.Rule ||
            cell.column.id === Columns.SourceIP ||
            cell.column.id === Columns.Chains;
          const isHost = cell.column.id === Columns.Host;
          return (
            <div
              role="cell"
              className={cn(
                "h-9.25 shrink-0 overflow-hidden px-3.5 text-body leading-9 text-ellipsis whitespace-nowrap border-b border-border text-foreground transition-colors duration-150 group-hover:bg-row-hover",
                alignClass(cell.column.id),
                isHost && "sticky left-0 z-10 bg-card",
                scrolled && isHost && stickyShadow,
                row.original?.completed && "bg-inset text-muted-foreground",
                selected && !row.original?.completed && "bg-inset",
                monospace && "font-mono text-label",
              )}
              style={{
                flex: `${size} ${cell.column.id === lastVisibleId ? 1 : 0} ${size}px`,
              }}
              key={cell.column.id}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          );
        })}
      </div>
    );
  });

  // The dialog states the real scope: active rows only, filtered or all.
  const targetCount = (
    closeFiltered
      ? instance.getFilteredRowModel().rows
      : instance.getRowModel().rows
  ).filter((row) => !row.original.completed).length;

  if (!isConnected) {
    return (
      <div className="page connections-page">
        {!mobile && <Header title={t("title")} />}
        <DisconnectedState description={t("disconnectedNotice")} />
      </div>
    );
  }

  return (
    <div className="page connections-page">
      {cardMode ? (
        /* 行動視口：緊湊工具行——狀態、會話累計、保留已關閉與一鍵斷開
           一件不少。嵌入動態分頁時宿主供頁標題；直達路由時補 Header，
           工具簇不再用桌面形制硬折行（破壞性圖標曾孤行）。 */
        <>
          {!mobile && <Header title={t("title")} />}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "status-dot shrink-0",
                streamState === "open" && "online",
              )}
              aria-label={r(streamState)}
            />
            <output
              className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/80 bg-inset px-2.5 py-1 text-caption leading-4 text-muted-foreground tabular-nums"
              aria-label={`${t("total.upload")} ${formatTraffic(traffic.uploadTotal)} · ${t("total.download")} ${formatTraffic(traffic.downloadTotal)}`}
            >
              <span className="inline-flex items-center gap-1">
                <ArrowUp aria-hidden="true" className="size-3 text-upload" />
                <span className="sr-only">{t("total.upload")}</span>
                <b className="font-semibold text-foreground">
                  {formatTraffic(traffic.uploadTotal)}
                </b>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <ArrowDown aria-hidden="true" className="size-3" />
                <span className="sr-only">{t("total.download")}</span>
                <b className="font-semibold text-foreground">
                  {formatTraffic(traffic.downloadTotal)}
                </b>
              </span>
            </output>
            <span className="inline-flex shrink-0 items-center">
              <Switch
                size="sm"
                checked={save}
                onCheckedChange={() => toggleSave()}
                aria-label={t("keepClosed")}
              />
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("closeAllTitle")}
              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(event) => {
                closeTrigger.current = event.currentTarget;
                setCloseFiltered(false);
                show();
              }}
            >
              <Unplug className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <Header title={t("title")}>
          <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
              <span
                className={cn("status-dot", streamState === "open" && "online")}
              />
              {r(streamState)}
            </span>
            <output
              className="inline-flex items-center gap-2 rounded-lg border border-border/80 bg-inset px-2.5 py-1 text-caption leading-4 text-muted-foreground tabular-nums"
              aria-label={`${t("total.upload")} ${formatTraffic(traffic.uploadTotal)} · ${t("total.download")} ${formatTraffic(traffic.downloadTotal)}`}
            >
              <span className="inline-flex items-center gap-1">
                <ArrowUp aria-hidden="true" className="size-3 text-upload" />
                <span className="sr-only">{t("total.upload")}</span>
                <b className="font-semibold text-foreground">
                  {formatTraffic(traffic.uploadTotal)}
                </b>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <ArrowDown aria-hidden="true" className="size-3" />
                <span className="sr-only">{t("total.download")}</span>
                <b className="font-semibold text-foreground">
                  {formatTraffic(traffic.downloadTotal)}
                </b>
              </span>
            </output>
            <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground max-md:min-h-11">
              <Switch
                size="sm"
                checked={save}
                onCheckedChange={() => toggleSave()}
                aria-label={t("keepClosed")}
              />
              {t("keepClosed")}
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("closeAllTitle")}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={(event) => {
                closeTrigger.current = event.currentTarget;
                setCloseFiltered(false);
                show();
              }}
            >
              <Unplug className="size-4" />
            </Button>
          </div>
        </Header>
      )}
      {cardMode ? (
        <div className="flex items-center gap-2">
          {/* 移動端：4 個過濾框合併為單一全字段搜索。 */}
          <input
            aria-label={t("filterHost")}
            placeholder={t("filterHost")}
            className="h-10 min-w-0 flex-1 rounded-xl border border-border/80 bg-inset/60 px-3 text-sm max-md:h-11 max-md:text-base text-foreground placeholder:text-muted-foreground/50 hover:border-brand/40 focus:border-brand focus:bg-card focus:outline-none"
            value={mobileQuery}
            onChange={(event) => setMobileQuery(event.target.value)}
          />
          {save && (
            <Button variant="outline" size="sm" onClick={clearClosed}>
              {tc("clear")}
            </Button>
          )}
        </div>
      ) : (
        <div className="page-toolbar items-center gap-2">
          {(["host", "process", "rule", "chains"] as const).map((key) => (
            <input
              key={key}
              aria-label={t(filterFields[key])}
              placeholder={t(filterFields[key])}
              className="h-8 min-w-0 flex-1 basis-32 rounded-xl border border-border/80 bg-inset/60 px-2.5 text-xs text-foreground transition-all duration-150 placeholder:text-muted-foreground/50 hover:border-brand/40 focus:border-brand focus:bg-card focus:outline-none"
              value={filters[key]}
              onChange={(event) => setFilters(key, event.target.value)}
            />
          ))}
          <Button
            variant="destructive"
            size="sm"
            disabled={
              pending ||
              !instance
                .getFilteredRowModel()
                .rows.some((row) => !row.original.completed)
            }
            onClick={(event) => {
              closeTrigger.current = event.currentTarget;
              setCloseFiltered(true);
              show();
            }}
          >
            {t("closeFiltered")}
          </Button>
          {save && (
            <Button variant="outline" size="sm" onClick={clearClosed}>
              {tc("clear")}
            </Button>
          )}
        </div>
      )}
      {save && (
        <p className="text-xs text-muted-foreground">{t("retention")}</p>
      )}
      {devices.length > 1 && (
        <Devices
          devices={devices}
          selected={device}
          onChange={handleDeviceSelected}
        />
      )}
      {cardMode ? (
        // 移動端卡片流：告別 11 列表格；點擊卡片從底部彈出詳情。
        <ul className="flex min-h-[280px] list-none flex-col gap-2 overflow-y-auto p-0">
          {mobileRows.length === 0 ? (
            <EmptyState
              className="py-16"
              icon={
                <ArrowLeftRight
                  aria-hidden="true"
                  className="size-7 text-muted-foreground/50"
                />
              }
              message={
                streamState !== "open"
                  ? r(streamState)
                  : data.length > 0
                    ? tc("empty")
                    : t("empty")
              }
            />
          ) : (
            mobileRows.slice(0, MOBILE_CARD_LIMIT).map((row) => (
              <ConnectionCard
                key={row.id}
                row={row}
                onOpen={() =>
                  setDrawerState({
                    visible: true,
                    selectedID: row.id,
                  })
                }
              />
            ))
          )}
        </ul>
      ) : (
        // flex-col + flex-1 on the scroller: h-full does not resolve against
        // the card's flex-grown height here, leaving the card half-filled.
        <Card className="relative flex min-h-[280px] flex-1 flex-col overflow-hidden p-0">
          <div
            ref={tableScrollRef}
            className="min-h-0 w-full flex-1 overflow-auto"
            onScroll={(event) =>
              setScrollStart(
                Math.max(
                  0,
                  Math.floor((event.currentTarget.scrollTop - 32) / 37) - 10,
                ),
              )
            }
          >
            <div
              role="table"
              className="flex flex-col tabular-nums"
              style={{ minWidth: instance.getTotalSize() }}
            >
              <div
                role="row"
                className="group sticky top-0 z-20 flex whitespace-nowrap"
              >
                {headers}
              </div>
              {start > 0 && (
                <div aria-hidden="true" style={{ height: start * 37 }} />
              )}
              {content}
              {end < rows.length && (
                <div
                  aria-hidden="true"
                  style={{ height: (rows.length - end) * 37 }}
                />
              )}
            </div>
            {instance.getRowModel().rows.length === 0 && (
              <EmptyState
                className="absolute inset-x-0 bottom-0 top-8"
                icon={
                  <ArrowLeftRight
                    aria-hidden="true"
                    className="size-7 text-muted-foreground/50"
                  />
                }
                message={
                  streamState !== "open"
                    ? r(streamState)
                    : instance.getCoreRowModel().rows.length > 0
                      ? tc("empty")
                      : t("empty")
                }
                action={
                  instance.getCoreRowModel().rows.length > 0 ? (
                    <button
                      className="empty-state-action"
                      onClick={() => {
                        setFilters({
                          host: "",
                          process: "",
                          rule: "",
                          chains: "",
                        });
                        setDevice("");
                      }}
                    >
                      {tc("clear")}
                    </button>
                  ) : undefined
                }
              />
            )}
          </div>
        </Card>
      )}
      <AlertDialog
        open={visible}
        onOpenChange={(open) => {
          if (!open && !pending) hide();
        }}
      >
        <AlertDialogContent
          className="data-[size=default]:sm:max-w-[400px]"
          onCloseAutoFocus={(event) => {
            if (closeTrigger.current?.isConnected) {
              event.preventDefault();
              closeTrigger.current.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeAllTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {closeFiltered
              ? t("filteredConfirm", { count: targetCount })
              : t("closeAllMessage", { count: targetCount })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                handleCloseConnections();
              }}
            >
              {t("closeAllConfirm", { count: targetCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet
        open={drawerState.visible}
        onOpenChange={(open) => {
          if (!open) setDrawerState("visible", false);
        }}
      >
        {/* The sheet renders its own header row with a close icon, so the
            built-in corner button stays off; no extra description exists.
            手機上從底部彈出，關閉按鈕回到拇指可及的範圍。 */}
        <SheetContent
          side={cardMode ? "bottom" : "right"}
          showCloseButton={false}
          aria-describedby={undefined}
          className={cn(
            "gap-0",
            cardMode
              ? "max-h-[85dvh] overflow-y-auto rounded-t-3xl"
              : "w-[450px] max-w-full sm:max-w-[450px]",
          )}
        >
          <div className="flex h-9 items-center justify-between border-b border-border/60 pr-3 pl-4">
            <SheetTitle className="text-label font-semibold">
              {t("info.title")}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tc("close")}
              onClick={() => setDrawerState("visible", false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <ConnectionInfo
            className="mt-1 px-5"
            connection={drawerState.connection}
          />
          <div className="mt-2 flex justify-end pr-5 pb-4">
            <Button
              variant="destructive"
              disabled={pending || drawerState.connection.completed}
              onClick={() => handleConnectionClosed()}
            >
              {t("info.closeConnection")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
