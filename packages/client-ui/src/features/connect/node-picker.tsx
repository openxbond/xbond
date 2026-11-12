import type { Group, Proxy } from "@xbond/client/request";
import { ArrowUpDown, Check, Pin, Server, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { List, type RowComponentProps } from "react-window";

import {
  CountryFlag,
  nodeFlagCode,
  renderNodeTitle,
  stripFlagEmoji,
} from "@/components/country-flag";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { type SelectResult } from "@/features/proxies/use-node-selection";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/platform/host";
import { usePinnedNodes } from "@/state/user-preferences";

export type SelectionResult = "idle" | "success" | "failed" | "partial";

/** 延遲分級的顯示色：快＝成功、中＝警告、慢＝危險。 */
function latencyClass(delay: number) {
  if (delay < 150) return "text-success-text";
  if (delay <= 400) return "text-warning-text";
  return "text-destructive-text";
}

interface NodePickerRowData {
  candidates: string[];
  pickerGroup: Group;
  pendingNode: string | null;
  pick: (name: string) => void;
  nodeDelay: (name: string) => number | null;
  mapping?: Map<string, Proxy | Group>;
  isPinned: (name: string) => boolean;
  togglePin: (name: string) => void;
  typeDirect: string;
  typeReject: string;
  switchingText: string;
  pinText: string;
  unpinText: string;
}

function NodePickerRow({
  index,
  style,
  candidates,
  pickerGroup,
  pendingNode,
  pick,
  nodeDelay,
  mapping,
  isPinned,
  togglePin,
  typeDirect,
  typeReject,
  switchingText,
  pinText,
  unpinText,
}: RowComponentProps<NodePickerRowData>) {
  const name = candidates[index];
  if (!name) return null;

  const delay = nodeDelay(name);
  const selected = pickerGroup.now === name;
  const pinned = isPinned(name);
  const flag = nodeFlagCode(name);
  const cleanName = flag ? stripFlagEmoji(name) : name;
  const item = mapping?.get(name);
  const itemType = item?.type;
  const isGroup =
    itemType === "Selector" ||
    itemType === "URLTest" ||
    itemType === "Fallback";
  const isBuiltin =
    itemType === "Direct" || itemType === "Reject" || itemType === "DNS";

  return (
    <div style={style} className="px-0.5 py-0.5">
      <div
        className={cn(
          "group flex min-h-11 w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-row-hover",
          selected && "bg-brand-soft font-medium text-brand-text",
          pinned && !selected && "bg-inset/40",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit font-[inherit] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={pickerGroup.type !== "Selector" || pendingNode !== null}
          onClick={() => pick(name)}
        >
          {flag ? (
            <CountryFlag
              code={flag}
              className="h-[16px] w-[22px] shrink-0 rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
            />
          ) : (
            <span
              className="grid size-5 shrink-0 place-items-center rounded bg-inset text-muted-foreground"
              aria-hidden="true"
            >
              <Server className="size-3 shrink-0" />
            </span>
          )}

          <span className="min-w-0 flex-1 flex items-center gap-1.5 truncate">
            <span className="truncate">{cleanName}</span>
            {itemType && !isBuiltin && !isGroup && (
              <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 font-mono text-caption uppercase text-muted-foreground">
                {itemType}
              </span>
            )}
            {isBuiltin && (
              <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 text-caption text-muted-foreground">
                {itemType === "Direct" ? typeDirect : typeReject}
              </span>
            )}
            {isGroup && (
              <span className="shrink-0 rounded bg-brand-soft/70 px-1.5 py-0.5 text-caption font-medium text-brand-text">
                {itemType}
              </span>
            )}
          </span>

          {pendingNode === name ? (
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {switchingText}
            </span>
          ) : delay ? (
            <span
              className={cn(
                "shrink-0 font-mono text-xs tabular-nums font-semibold",
                latencyClass(delay),
              )}
            >
              {delay} ms
            </span>
          ) : null}

          {selected && <Check className="size-4 shrink-0 text-brand-text" />}
        </button>

        {/* Pin toggle button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePin(name);
          }}
          className={cn(
            "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground transition-[color,background-color,opacity] duration-150 hover:bg-card hover:text-foreground",
            pinned
              ? "text-warning-text opacity-100 hover:text-foreground"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          title={pinned ? unpinText : pinText}
          aria-label={pinned ? unpinText : pinText}
        >
          <Pin className={cn("size-3.5", pinned && "fill-current")} />
        </button>
      </div>
    </div>
  );
}

/**
 * 節點選擇抽屜：專注為當前策略組選擇節點。
 * 支援虛擬化快速渲染（千級節點無卡頓）、釘選置頂（Pin）、按延遲/名稱多維度排序與即選即切。
 */
export function NodePicker({
  open,
  onClose,
  groups,
  loading,
  focusGroupName,
  onFocusGroup,
  chain,
  nodeDelay,
  mapping,
  selection,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  loading?: boolean;
  focusGroupName: string | null;
  onFocusGroup?: (name: string) => void;
  chain: string[];
  nodeDelay: (name: string) => number | null;
  mapping?: Map<string, Proxy | Group>;
  selection: { pending: boolean; result: SelectionResult };
  onSelect: (groupName: string, nodeName: string) => Promise<SelectResult>;
}) {
  const { t } = useTranslation("connect");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pendingNode, setPendingNode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "latency" | "name">(
    "default",
  );
  const { isPinned, togglePin } = usePinnedNodes();

  const pickerGroup =
    groups.find((item) => item.name === focusGroupName) ?? groups[0] ?? null;

  // 過濾與多維度排序（釘選優先 + 延遲/名稱排序）
  const candidates = useMemo(() => {
    if (!pickerGroup) return [];
    const q = query.trim().toLowerCase();
    const visible = pickerGroup.all.filter(
      (name) => !q || name.toLowerCase().includes(q),
    );

    const pinnedList: string[] = [];
    const normalList: string[] = [];
    for (const name of visible) {
      if (isPinned(name)) {
        pinnedList.push(name);
      } else {
        normalList.push(name);
      }
    }

    const sortFn = (a: string, b: string) => {
      if (sortMode === "name") return a.localeCompare(b);
      if (sortMode === "latency") {
        const da = nodeDelay(a);
        const db = nodeDelay(b);
        const ka = da !== null && da > 0 ? da : Number.POSITIVE_INFINITY;
        const kb = db !== null && db > 0 ? db : Number.POSITIVE_INFINITY;
        return ka === kb ? a.localeCompare(b) : ka - kb;
      }
      return 0;
    };

    if (sortMode !== "default") {
      pinnedList.sort(sortFn);
      normalList.sort(sortFn);
    }

    return [...pinnedList, ...normalList];
  }, [pickerGroup, query, isPinned, sortMode, nodeDelay]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const panel = panelRef.current;
    const buttons = () =>
      Array.from(
        panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ??
          [],
      );
    buttons()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = buttons();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel?.addEventListener("keydown", trapFocus);
    return () => {
      panel?.removeEventListener("keydown", trapFocus);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);

  async function pick(name: string) {
    if (!pickerGroup) return;
    setPendingNode(name);
    try {
      const result = await onSelect(pickerGroup.name, name);
      // 失敗時留在抽屜：底部狀態行就是失敗交代，立刻關閉會把它藏掉。
      if (result !== "failed") {
        setTimeout(() => {
          onClose();
        }, 200);
      }
    } finally {
      setPendingNode(null);
    }
  }

  const sortLabel =
    sortMode === "latency"
      ? px("sortLatency")
      : sortMode === "name"
        ? px("sortName")
        : px("sortDefault");

  return (
    <Sheet
      open={open}
      onOpenChange={(sheetOpen) => {
        if (!sheetOpen) onClose();
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "overflow-hidden p-0",
          isMobile
            ? "h-[85dvh] rounded-t-3xl"
            : "w-[380px] max-w-full sm:max-w-[380px]",
        )}
      >
        <div
          className="flex h-full flex-col gap-3 p-4 sm:p-5 pb-[calc(env(safe-area-inset-bottom)+8px)] sm:pb-4"
          ref={panelRef as RefObject<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          aria-label={t("nodeSelection")}
        >
          {/* 抽屜頭部 */}
          <header className="flex items-center justify-between gap-3 shrink-0">
            <SheetTitle asChild>
              <h3 className="text-base font-semibold text-foreground">
                {t("nodeSelection")}
              </h3>
            </SheetTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={tc("close")}
            >
              <X aria-hidden="true" />
            </Button>
          </header>

          {/* 策略組切換：多於 1 個策略組時以下拉菜單展示 */}
          {groups.length > 1 && (
            <div className="shrink-0">
              <Select
                value={pickerGroup?.name}
                onValueChange={(val) => onFocusGroup?.(val)}
              >
                <SelectTrigger
                  className="h-10 sm:h-11 w-full justify-between rounded-xl border border-border/80 bg-card/90 px-3 py-2 text-xs shadow-2xs transition-colors hover:border-brand/40 hover:bg-card focus:border-brand"
                  aria-label={t("strategyGroups")}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5 pe-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {t("strategyGroups")}:
                      </span>
                      <span className="truncate text-xs font-semibold text-foreground">
                        {pickerGroup?.name
                          ? renderNodeTitle(pickerGroup.name)
                          : ""}
                      </span>
                      {pickerGroup?.type && (
                        <span className="shrink-0 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                          {pickerGroup.type}
                        </span>
                      )}
                    </div>
                    {pickerGroup && (
                      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        {pickerGroup.now && (
                          <span className="hidden sm:inline-block max-w-[140px] truncate text-muted-foreground/80">
                            {renderNodeTitle(pickerGroup.now)}
                          </span>
                        )}
                        {pickerGroup.now && (
                          <span className="hidden sm:inline text-muted-foreground/40">
                            ·
                          </span>
                        )}
                        <span className="font-mono tabular-nums">
                          {px("groupMembers", {
                            count: pickerGroup.all.length,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  sideOffset={4}
                  className="z-[1100] max-h-80 w-[var(--radix-select-trigger-width)] p-1.5"
                >
                  <SelectGroup>
                    {groups.map((item) => (
                      <SelectItem
                        key={item.name}
                        value={item.name}
                        className="py-2 px-2.5 text-xs rounded-lg cursor-pointer"
                      >
                        <div className="flex w-full min-w-0 flex-col gap-0.5">
                          <div className="flex w-full min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-semibold text-foreground text-xs">
                                {renderNodeTitle(item.name)}
                              </span>
                              {item.type && (
                                <span className="shrink-0 rounded border border-border/60 bg-muted/60 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
                                  {item.type}
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/75">
                              {px("groupMembers", { count: item.all.length })}
                            </span>
                          </div>
                          {item.now && (
                            <div className="flex w-full min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                              <span className="min-w-0 truncate text-muted-foreground/90">
                                {renderNodeTitle(item.now)}
                              </span>
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 僅單一策略組時以靜態信息展示 */}
          {groups.length === 1 && pickerGroup && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span>
                {t("strategyGroups")}:{" "}
                <b className="text-foreground">
                  {renderNodeTitle(pickerGroup.name)}
                </b>
              </span>
              <span className="rounded bg-inset px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                {pickerGroup.type}
              </span>
              <span className="tabular-nums">
                ({px("groupMembers", { count: pickerGroup.all.length })})
              </span>
            </div>
          )}

          {/* 搜尋與排序工具列 */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex-1">
              <InputGroup>
                <InputGroupInput
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={px("searchPlaceholder")}
                  placeholder={px("searchPlaceholder")}
                />
                {query && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      onClick={() => setQuery("")}
                      aria-label={tc("clear")}
                    >
                      <X aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-9 shrink-0 gap-1.5 px-2.5 text-xs",
                sortMode !== "default" &&
                  "border-brand bg-brand-soft font-medium text-brand-text",
              )}
              onClick={() => {
                setSortMode((prev) =>
                  prev === "default"
                    ? "latency"
                    : prev === "latency"
                      ? "name"
                      : "default",
                );
              }}
              title={px("sortState", { mode: sortLabel })}
              aria-label={px("sortState", { mode: sortLabel })}
            >
              <ArrowUpDown className="size-3.5" />
              <span>{sortLabel}</span>
            </Button>
          </div>

          {/* 策略鏈鏈路提示 */}
          {chain.length > 2 && (
            <div
              className="shrink-0 rounded-lg bg-inset p-2 text-label text-muted-foreground truncate"
              title={chain.join(" → ")}
            >
              <span className="mr-1 font-semibold text-foreground">
                {t("routingChain")}:
              </span>
              {chain.join(" → ")}
            </div>
          )}

          {/* 候選節點列表（虛擬滾動） */}
          {pickerGroup ? (
            <>
              {pickerGroup.type !== "Selector" && (
                <div className="shrink-0 rounded-lg bg-brand-soft/40 p-2.5 text-xs text-brand-text">
                  {t("autoSelected")}
                  <b className="font-semibold">{pickerGroup.now}</b>
                </div>
              )}

              {candidates.length === 0 ? (
                <div className="grid flex-1 place-items-center py-12 text-xs text-muted-foreground">
                  {tc("empty")}
                </div>
              ) : (
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <List
                    rowCount={candidates.length}
                    rowHeight={48}
                    rowComponent={NodePickerRow}
                    rowProps={{
                      candidates,
                      pickerGroup,
                      pendingNode,
                      pick: (name) => void pick(name),
                      nodeDelay,
                      mapping,
                      isPinned,
                      togglePin,
                      typeDirect: t("typeDirect"),
                      typeReject: t("typeReject"),
                      switchingText: px("switching"),
                      pinText: px("pin"),
                      unpinText: px("unpin"),
                    }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      overflow: "auto",
                    }}
                  />
                </div>
              )}

              {(selection.pending || selection.result !== "idle") && (
                <footer className="shrink-0">
                  <span
                    className={cn(
                      "text-label",
                      selection.result === "failed"
                        ? "text-destructive-text"
                        : selection.result === "partial"
                          ? "text-warning-text"
                          : "text-success-text",
                    )}
                    role="status"
                  >
                    {px(
                      selection.pending
                        ? "switching"
                        : selection.result === "success"
                          ? "switched"
                          : selection.result === "partial"
                            ? "switchPartial"
                            : "switchFailed",
                    )}
                  </span>
                </footer>
              )}
            </>
          ) : loading ? (
            <p className="text-body text-muted-foreground">{tc("loading")}</p>
          ) : groups.length === 0 ? (
            <p className="text-body text-muted-foreground">{t("noGroups")}</p>
          ) : (
            <p className="text-body text-muted-foreground">{t("noGroup")}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
