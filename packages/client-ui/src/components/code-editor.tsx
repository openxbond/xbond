import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface CodeEditorProps {
  /** Initial document; the editor is uncontrolled after mount. */
  value: string;
  /** Hands the live view to the caller so save paths can read
   * `view.state.doc.toString()` without copying the whole document on
   * every keystroke — a multi-MB config would make per-keystroke string
   * materialization the bottleneck. */
  onViewReady?: (view: EditorView) => void;
  className?: string;
  ariaLabel?: string;
}

/** Virtualized code editor for large configuration documents. A bare
 * <textarea> lays out the entire content (O(document)); files of a few MB
 * freeze the whole webview, so editing raw sources goes through CodeMirror,
 * which only renders the viewport. */
export default function CodeEditor({
  value,
  onViewReady,
  className,
  ariaLabel,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onViewReady);
  readyRef.current = onViewReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        yaml(),
        EditorView.theme({
          "&": {
            // height:100% against the host's explicit height (h-[60vh]).
            // The host must carry a definite height: percentage heights on
            // flex children do not resolve on WebKitGTK, and CM pins the
            // root to position:relative !important, so the editor cannot be
            // absolutely positioned — sizing has to come from the host.
            height: "100%",
            color: "var(--foreground)",
            backgroundColor: "transparent",
          },
          ".cm-scroller": {
            // overflow:auto is required for vertical scrolling: CM's base
            // theme only sets overflow-x, and Chromium's "visible becomes
            // auto when the other axis scrolls" rule does not hold on
            // WebKitGTK, which left the editor without any vertical scroll.
            overflow: "auto",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            lineHeight: "1.6",
          },
          ".cm-content": {
            padding: "8px 0",
            caretColor: "var(--foreground)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--surface-inset)",
            color: "var(--muted-foreground)",
            border: "none",
          },
          ".cm-activeLine": {
            backgroundColor:
              "color-mix(in oklab, var(--foreground) 4%, transparent)",
          },
          ".cm-activeLineGutter": {
            backgroundColor:
              "color-mix(in oklab, var(--foreground) 6%, transparent)",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor:
              "color-mix(in oklab, var(--brand) 20%, transparent) !important",
          },
        }),
      ],
    });
    view.focus();
    readyRef.current?.(view);
    return () => {
      view.destroy();
    };
    // value 只作为初始文档；关闭对话框即销毁实例，重开时以最新内容重挂载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      dir="ltr"
      aria-label={ariaLabel}
      className={cn(
        // Definite height is required: the editor root is height:100% (CM
        // pins its own position to relative !important, so it cannot be
        // absolutely filled), and WebKitGTK does not resolve percentage
        // heights against flex-determined parents.
        "relative overflow-hidden rounded-control border border-[var(--glass-border)] bg-inset/60 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 [&_.cm-editor]:outline-none",
        className,
      )}
    />
  );
}
