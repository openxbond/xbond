import { Header, Icon, Card, Button, Input, EmptyState } from "@components";
import { Checkbox } from "@components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@components/ui/sheet";
import { useAction } from "@lib/actions";
import { fromNow } from "@lib/date";
import { useObject, useVisible } from "@lib/hook";
import { cn } from "@lib/utils";
import {
  useIntersectionObserver,
  useMediaQuery,
  useSyncedRef,
} from "@react-hookz/web";
import {
  useClient,
  useConnectionStreamReader,
  useLanguage,
  useStreamState,
  identityAtom,
} from "@stores";
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
import { useSetAtom } from "jotai";
import { useMemo, useLayoutEffect, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { groupBy } from "remeda";

import { Devices } from "./Devices";
import { ConnectionInfo } from "./Info";
import {
  type Connection,
  type FormatConnection,
  useConnections,
} from "./store";

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

function formatSpeed(upload: number, download: number) {
  switch (true) {
    case upload === 0 && download === 0:
      return "-";
    case upload !== 0 && download !== 0:
      return `↑ ${formatTraffic(upload)}/s ↓ ${formatTraffic(download)}/s`;
    case upload !== 0:
      return `↑ ${formatTraffic(upload)}/s`;
    default:
      return `↓ ${formatTraffic(download)}/s`;
  }
}

const columnHelper = createColumnHelper<FormatConnection>();

export default function Connections() {
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
  const setIdentity = useSetAtom(identityAtom);

  // total
  const [traffic, setTraffic] = useObject({
    uploadTotal: 0,
    downloadTotal: 0,
  });

  // close all connections
  const { visible, show, hide } = useVisible();
  function handleCloseConnections() {
    void run(async () => {
      if (closeFiltered) {
        const ids = instance
          .getFilteredRowModel()
          .rows.filter((row) => !row.original.completed)
          .map((row) => row.original.id);
        await Promise.all(ids.map((id) => client.closeConnection(id)));
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
        minSize: 90,
        size: 90,
        header: t(`columns.${Columns.Type}`),
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
        minSize: 180,
        size: 180,
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
        cell: (cell) => formatSpeed(cell.getValue()[0], cell.getValue()[1]),
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
  const columnFilters = useMemo(
    () => [
      ...Object.entries(filters)
        .filter(([, value]) => value.trim())
        .map(([id, value]) => ({ id, value: value.trim() })),
      ...(device ? [{ id: Columns.SourceIP, value: device }] : []),
    ],
    [filters, device],
  );
  // Below the compact breakpoint the lowest-priority columns step aside so
  // host, process, chain and both rates stay in view without side-scrolling.
  const compact = useMediaQuery("(max-width: 767px)");
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
      columnVisibility: compact ? { sourceIP: false, time: false } : {},
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
          "connections-th table-header relative inline-block h-8 min-w-0 shrink-0 overflow-hidden px-3.5 text-ellipsis whitespace-nowrap leading-8",
          alignClass(id),
          isHost && "sticky left-[-0.1px] z-[99]",
          scrolled && isHost && stickyShadow,
        )}
        style={{ flex: `${header.getSize()} 0 ${header.getSize()}px` }}
        ref={isHost ? pinRef : undefined}
        key={id}
      >
        <button
          type="button"
          className="cursor-pointer bg-transparent font-[inherit] text-[inherit]"
          onClick={column.getToggleSortingHandler()}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
          {column.getIsSorted() !== false
            ? column.getIsSorted() === "desc"
              ? " ↓"
              : " ↑"
            : null}
        </button>
        {idx !== headerGroup.headers.length - 1 && (
          <div
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            className={cn(
              "connections-resizer absolute inset-y-2 -right-2.5 z-10 w-5 cursor-col-resize text-sm font-light opacity-0 touch-none transition-opacity duration-200",
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
    return (
      <div
        role="row"
        tabIndex={0}
        className="connections-data-row group flex h-9.25 cursor-default select-none focus-visible:bg-inset"
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
        {row.getAllCells().map((cell) => {
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
                "connections-block h-9.25 shrink-0 overflow-hidden px-3.5 text-body leading-9 text-ellipsis whitespace-nowrap border-b border-border text-foreground group-hover:bg-inset",
                alignClass(cell.column.id),
                isHost && "sticky left-0 z-998 bg-card",
                scrolled && isHost && stickyShadow,
                row.original?.completed && "bg-inset text-muted-foreground",
                monospace && "font-mono text-label",
              )}
              style={{ flex: `${size} 0 ${size}px` }}
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

  return (
    <div className="page connections-page">
      <Header title={t("title")}>
        <span className="connections-live ml-3 inline-flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          <span
            className={`status-dot ${streamState === "open" ? "online" : ""}`}
          />
          {r(streamState)}
        </span>
        <span className="connections-total ml-[15px] flex-1 cursor-default text-xs leading-5 text-muted-foreground tabular-nums">
          {t("total.upload")}{" "}
          <b className="font-semibold text-foreground">
            {formatTraffic(traffic.uploadTotal)}
          </b>
          <span aria-hidden="true" className="total-divider mx-2">
            ·
          </span>
          {t("total.download")}{" "}
          <b className="font-semibold text-foreground">
            {formatTraffic(traffic.downloadTotal)}
          </b>
        </span>
        <label className="connections-filter ml-[15px] inline-flex min-h-6 max-md:min-h-11 cursor-pointer items-center gap-2 text-sm leading-5 text-muted-foreground hover:text-foreground">
          <Checkbox
            checked={save}
            onCheckedChange={() => toggleSave()}
            aria-label={t("keepClosed")}
          />
          {t("keepClosed")}
        </label>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("closeAllTitle")}
          className="connections-filter ml-[15px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setCloseFiltered(false);
            show();
          }}
        >
          <Icon type="close-all" size={20} />
        </Button>
      </Header>
      <div className="page-toolbar">
        {(["host", "process", "rule", "chains"] as const).map((key) => (
          <label
            key={key}
            className="flex min-w-35 flex-1 flex-col gap-1 text-xs text-muted-foreground"
          >
            {t(
              (
                {
                  host: "filterHost",
                  process: "filterProcess",
                  rule: "filterRule",
                  chains: "filterChain",
                } as const
              )[key],
            )}
            <Input
              aria-label={t(
                (
                  {
                    host: "filterHost",
                    process: "filterProcess",
                    rule: "filterRule",
                    chains: "filterChain",
                  } as const
                )[key],
              )}
              className="text-left"
              value={filters[key]}
              onChange={(event) => setFilters(key, event.target.value)}
            />
          </label>
        ))}
        <Button
          variant="destructive"
          disabled={
            pending ||
            !instance
              .getFilteredRowModel()
              .rows.some((row) => !row.original.completed)
          }
          onClick={() => {
            setCloseFiltered(true);
            show();
          }}
        >
          {t("closeFiltered")}
        </Button>
        {save && <Button onClick={clearClosed}>{tc("clear")}</Button>}
      </div>
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
      <Card className="connections-card relative mt-2.5 flex min-h-[280px] flex-1 overflow-hidden p-0">
        <div
          className="connections-scroll h-full w-full overflow-auto"
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
            className="connections-table flex flex-col tabular-nums"
            style={{ minWidth: instance.getTotalSize() }}
          >
            <div
              role="row"
              className="connections-header group sticky top-0 z-[999] flex whitespace-nowrap"
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
              className="connections-empty absolute inset-x-0 bottom-0 top-8"
              message={t("empty")}
              action={
                <button
                  className="empty-state-action"
                  onClick={() => setIdentity(false)}
                >
                  {t("emptyAction")}
                </button>
              }
            />
          )}
        </div>
      </Card>
      <Dialog
        open={visible}
        onOpenChange={(open) => {
          if (!open && !pending) hide();
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("closeAllTitle")}</DialogTitle>
          </DialogHeader>
          <div>
            {closeFiltered
              ? t("filteredConfirm", { count: targetCount })
              : t("closeAllMessage", { count: targetCount })}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={hide}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={handleCloseConnections}
            >
              {t("closeAllConfirm", { count: targetCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet
        open={drawerState.visible}
        onOpenChange={(open) => {
          if (!open) setDrawerState("visible", false);
        }}
      >
        {/* The sheet renders its own header row with a close icon, so the
            built-in corner button stays off; no extra description exists. */}
        <SheetContent
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          className="w-[450px] max-w-full gap-0 sm:max-w-[450px]"
        >
          <div className="flex h-8 items-center justify-between">
            <SheetTitle className="pl-3 font-bold">
              {t("info.title")}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tc("close")}
              onClick={() => setDrawerState("visible", false)}
            >
              <Icon type="close" size={16} />
            </Button>
          </div>
          <ConnectionInfo
            className="mt-3 px-5"
            connection={drawerState.connection}
          />
          <div className="mt-3 flex justify-end pr-3">
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
