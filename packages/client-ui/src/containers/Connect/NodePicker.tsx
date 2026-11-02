import { CountryFlag } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
import { Sheet, SheetContent, SheetTitle } from "@components/ui/sheet";
import type { Group } from "@xbond/client/request";
import { cn } from "cn";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export type SelectionResult = "idle" | "success" | "failed" | "partial";

/** 延遲分擋的顯示色：快＝成功、中＝警告、慢＝危險。 */
export function latencyClass(delay: number) {
  if (delay < 150) return "text-success-text";
  if (delay <= 400) return "text-warning-text";
  return "text-destructive-text";
}

/**
 * 節點選擇抽屜：策略組 chips + 候選行。切換在原位回應，失敗保留原選中；
 * 首次打開才掛載，避免常駐離屏層。
 */
export function NodePicker({
  open,
  onClose,
  groups,
  focusGroupName,
  onFocusGroup,
  chain,
  nodeDelay,
  selection,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  focusGroupName: string | null;
  onFocusGroup: (name: string) => void;
  chain: string[];
  nodeDelay: (name: string) => number | null;
  selection: { pending: boolean; result: SelectionResult };
  onSelect: (groupName: string, nodeName: string) => Promise<void>;
}) {
  const { t } = useTranslation("connect");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const panelRef = useRef<HTMLDivElement>(null);
  const [pendingNode, setPendingNode] = useState<string | null>(null);

  const pickerGroup =
    groups.find((item) => item.name === focusGroupName) ?? groups[0] ?? null;

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
        className="w-[360px] max-w-full overflow-y-auto sm:max-w-[360px]"
      >
        <div
          className="flex h-full flex-col gap-3.5 py-5 px-[18px]"
          ref={panelRef as RefObject<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          aria-label={t("strategy.title")}
        >
          <header className="flex items-center justify-between">
            <SheetTitle asChild>
              <h3 className="text-base font-semibold">{t("currentNode")}</h3>
            </SheetTitle>
            <button
              type="button"
              className="cursor-pointer rounded-sm px-1.5 py-1 text-[13px] font-semibold text-brand-text"
              onClick={onClose}
              aria-label={tc("close")}
            >
              ✕
            </button>
          </header>

          {groups.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((item) => (
                <button
                  type="button"
                  key={item.name}
                  aria-pressed={pickerGroup?.name === item.name}
                  className={cn(
                    "max-w-full cursor-pointer truncate rounded-full border border-border bg-inset px-3 py-1.5 text-[12.5px] text-muted-foreground",
                    pickerGroup?.name === item.name &&
                      "border-transparent bg-brand-soft font-semibold text-brand-text",
                  )}
                  onClick={() => onFocusGroup(item.name)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          {pickerGroup ? (
            <>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {chain.join(" → ") || pickerGroup.name}
              </p>
              <ul className="m-0 flex flex-1 list-none flex-col gap-1 overflow-y-auto p-0">
                {pickerGroup.all.map((name) => {
                  const delay = nodeDelay(name);
                  const selected = pickerGroup.now === name;
                  const flag = nodeFlagCode(name);
                  const cleanName = flag ? stripFlagEmoji(name) : name;
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        className={cn(
                          "flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-foreground enabled:hover:bg-row-hover disabled:cursor-not-allowed",
                          selected && "border-transparent bg-brand-soft",
                        )}
                        disabled={
                          pickerGroup.type !== "Selector" ||
                          pendingNode !== null
                        }
                        onClick={() => void pick(name)}
                      >
                        {flag && (
                          <CountryFlag
                            code={flag}
                            className="h-[15px] w-5 shrink-0 rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {cleanName}
                        </span>
                        {pendingNode === name ? (
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {px("switching")}
                          </span>
                        ) : delay ? (
                          <span
                            className={cn(
                              "shrink-0 font-mono text-xs tabular-nums",
                              latencyClass(delay),
                            )}
                          >
                            {delay}ms
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
                })}
              </ul>
              <footer className="min-h-5">
                {(selection.pending || selection.result !== "idle") && (
                  <span
                    className={cn(
                      "text-[12.5px]",
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
            <p className="text-[13.5px] text-muted-foreground">
              {t("noGroup")}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
