import { CountryFlag } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
import { Sheet, SheetContent, SheetTitle } from "@components/ui/sheet";
import { cn } from "@lib/utils";
import type { Group, Proxy } from "@xbond/client/request";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export type SelectionResult = "idle" | "success" | "failed" | "partial";

/** 延迟分级的显示色：快＝成功、中＝警告、慢＝危险。 */
export function latencyClass(delay: number) {
  if (delay < 150) return "text-success-text";
  if (delay <= 400) return "text-warning-text";
  return "text-destructive-text";
}

/**
 * 节点选择抽屉：专注为当前策略组选择节点。
 * 去除重复的策略组标签，加入搜索过滤、延迟指示与即选即切换。
 */
export function NodePicker({
  open,
  onClose,
  groups,
  focusGroupName,
  chain,
  nodeDelay,
  mapping,
  selection,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  focusGroupName: string | null;
  onFocusGroup?: (name: string) => void;
  chain: string[];
  nodeDelay: (name: string) => number | null;
  mapping?: Map<string, Proxy | Group>;
  selection: { pending: boolean; result: SelectionResult };
  onSelect: (groupName: string, nodeName: string) => Promise<void>;
}) {
  const { t } = useTranslation("connect");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const panelRef = useRef<HTMLDivElement>(null);
  const [pendingNode, setPendingNode] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const pickerGroup =
    groups.find((item) => item.name === focusGroupName) ?? groups[0] ?? null;

  // 过滤候选节点
  const candidates = (pickerGroup?.all ?? []).filter(
    (name) =>
      !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()),
  );

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
      await onSelect(pickerGroup.name, name);
      setTimeout(() => {
        onClose();
      }, 200);
    } finally {
      setPendingNode(null);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(sheetOpen) => {
        if (!sheetOpen) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[380px] max-w-full overflow-y-auto sm:max-w-[380px]"
      >
        <div
          className="flex h-full flex-col gap-3 py-5 px-5"
          ref={panelRef as RefObject<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          aria-label={t("nodeSelection")}
        >
          {/* 抽屉头部 */}
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <SheetTitle asChild>
                <h3 className="text-base font-semibold text-foreground">
                  {t("nodeSelection") || "选择节点"}
                </h3>
              </SheetTitle>
              {pickerGroup && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>
                    策略组:{" "}
                    <b className="text-foreground">{pickerGroup.name}</b>
                  </span>
                  <span className="rounded bg-inset px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                    {pickerGroup.type}
                  </span>
                  <span className="tabular-nums">
                    ({pickerGroup.all.length} 个成员)
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center justify-center rounded-sm px-1.5 py-1 max-md:min-h-11 max-md:min-w-11 text-body font-semibold text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label={tc("close")}
            >
              ✕
            </button>
          </header>

          {/* 节点搜索栏 */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={px("searchPlaceholder") || "搜索节点名称或地区..."}
              className="w-full rounded-[10px] border border-border bg-inset px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-xs text-muted-foreground hover:text-foreground max-md:size-11"
              >
                ✕
              </button>
            )}
          </div>

          {/* 策略链链路提示 */}
          {chain.length > 2 && (
            <div
              className="rounded-lg bg-inset p-2 text-label text-muted-foreground truncate"
              title={chain.join(" → ")}
            >
              <span className="font-semibold text-foreground mr-1">链路:</span>
              {chain.join(" → ")}
            </div>
          )}

          {/* 候选节点列表 */}
          {pickerGroup ? (
            <>
              {pickerGroup.type !== "Selector" && (
                <div className="rounded-lg bg-brand-soft/40 p-2.5 text-xs text-brand-text">
                  该策略组由核心自动优选节点，当前选用：
                  <b className="font-semibold">{pickerGroup.now}</b>
                </div>
              )}

              <ul className="m-0 flex flex-1 list-none flex-col gap-1 overflow-y-auto p-0 [scrollbar-width:thin]">
                {candidates.length === 0 ? (
                  <li className="grid py-12 place-items-center text-xs text-muted-foreground">
                    未找到匹配的节点
                  </li>
                ) : (
                  candidates.map((name) => {
                    const delay = nodeDelay(name);
                    const selected = pickerGroup.now === name;
                    const flag = nodeFlagCode(name);
                    const cleanName = flag ? stripFlagEmoji(name) : name;
                    const item = mapping?.get(name);
                    const itemType = item?.type;
                    const isGroup =
                      itemType === "Selector" ||
                      itemType === "URLTest" ||
                      itemType === "Fallback";
                    const isBuiltin =
                      itemType === "Direct" ||
                      itemType === "Reject" ||
                      itemType === "DNS";

                    return (
                      <li key={name}>
                        <button
                          type="button"
                          className={cn(
                            "flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-foreground enabled:hover:bg-row-hover disabled:cursor-not-allowed transition-colors",
                            selected &&
                              "border-transparent bg-brand-soft font-medium text-brand-text",
                          )}
                          disabled={
                            pickerGroup.type !== "Selector" ||
                            pendingNode !== null
                          }
                          onClick={() => void pick(name)}
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
                              <svg
                                viewBox="0 0 24 24"
                                width="12"
                                height="12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect
                                  x="2"
                                  y="2"
                                  width="20"
                                  height="8"
                                  rx="2"
                                />
                                <rect
                                  x="2"
                                  y="14"
                                  width="20"
                                  height="8"
                                  rx="2"
                                />
                                <line x1="6" y1="6" x2="6.01" y2="6" />
                                <line x1="6" y1="18" x2="6.01" y2="18" />
                              </svg>
                            </span>
                          )}

                          <span className="min-w-0 flex-1 flex items-center gap-2 truncate">
                            <span className="truncate">{cleanName}</span>
                            {itemType && !isBuiltin && !isGroup && (
                              <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 font-mono text-label uppercase text-muted-foreground">
                                {itemType}
                              </span>
                            )}
                            {isBuiltin && (
                              <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 text-label text-muted-foreground">
                                {itemType === "Direct" ? "直连" : "拦截"}
                              </span>
                            )}
                            {isGroup && (
                              <span className="shrink-0 rounded bg-brand-soft/70 px-1.5 py-0.5 text-label font-medium text-brand-text">
                                {itemType}
                              </span>
                            )}
                          </span>

                          {pendingNode === name ? (
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                              {px("switching")}
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

                          {selected && (
                            <svg
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="shrink-0 text-brand-text"
                              aria-hidden="true"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          )}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              <footer className="min-h-5">
                {(selection.pending || selection.result !== "idle") && (
                  <span
                    className={cn(
                      "text-label",
                      selection.result === "failed"
                        ? "text-destructive-text"
                        : "text-success-text",
                    )}
                    role="status"
                  >
                    {px(
                      selection.pending
                        ? "switching"
                        : selection.result === "success"
                          ? "switched"
                          : "switchFailed",
                    )}
                  </span>
                )}
              </footer>
            </>
          ) : (
            <p className="text-body text-muted-foreground">{t("noGroup")}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
