import { CountryFlag, Drawer } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
import type { Group } from "@xbond/client/request";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import "./picker.scss";

export type SelectionResult = "idle" | "success" | "failed" | "partial";

export function latencyClass(delay: number) {
  if (delay < 150) return "is-fast";
  if (delay <= 400) return "is-mid";
  return "is-slow";
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
    <Drawer visible={open} onClose={onClose} width={360}>
      <div
        className="node-picker"
        ref={panelRef as RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-label={t("strategy.title")}
      >
        <header className="picker-head">
          <h3>{t("currentNode")}</h3>
          <button
            type="button"
            className="text-btn"
            onClick={onClose}
            aria-label={tc("close")}
          >
            ✕
          </button>
        </header>

        {groups.length > 1 && (
          <div className="picker-groups">
            {groups.map((item) => (
              <button
                type="button"
                key={item.name}
                aria-pressed={pickerGroup?.name === item.name}
                className={`picker-group-chip ${pickerGroup?.name === item.name ? "active" : ""}`}
                onClick={() => onFocusGroup(item.name)}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}

        {pickerGroup ? (
          <>
            <p className="picker-chain">
              {chain.join(" → ") || pickerGroup.name}
            </p>
            <ul className="picker-nodes">
              {pickerGroup.all.map((name) => {
                const delay = nodeDelay(name);
                const selected = pickerGroup.now === name;
                const flag = nodeFlagCode(name);
                const cleanName = flag ? stripFlagEmoji(name) : name;
                return (
                  <li key={name}>
                    <button
                      type="button"
                      className={`picker-node-row ${selected ? "selected" : ""}`}
                      disabled={
                        pickerGroup.type !== "Selector" || pendingNode !== null
                      }
                      onClick={() => void pick(name)}
                    >
                      {flag && (
                        <CountryFlag code={flag} className="node-picker-flag" />
                      )}
                      <span className="node-name">{cleanName}</span>
                      {pendingNode === name ? (
                        <span className="node-latency">{px("switching")}</span>
                      ) : delay ? (
                        <span className={`node-latency ${latencyClass(delay)}`}>
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
                          className="picker-check"
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
            <footer className="picker-foot">
              {(selection.pending || selection.result !== "idle") && (
                <span
                  className={`node-switch-notice ${selection.result === "failed" ? "failed" : ""}`}
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
          <p className="picker-empty">{t("noGroup")}</p>
        )}
      </div>
    </Drawer>
  );
}
