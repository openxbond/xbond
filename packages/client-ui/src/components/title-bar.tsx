import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { invokeDesktop, isDesktopApp } from "@/platform/local-api-bootstrap";

/**
 * Desktop frameless-chrome titlebar (Windows/Linux): a 40px drag band whose
 * right edge carries the window controls. macOS keeps native traffic lights
 * (titleBarStyle Overlay in tauri.conf.json), so macOS only gets the drag
 * band. The shell owns minimize/maximize/close via app-defined commands;
 * close honors the close-to-tray preference like the tray close.
 *
 * `data-tauri-drag-region="deep"` makes the whole band draggable while the
 * control buttons (clickable elements) block dragging per Tauri's drag.js,
 * so no pointer-events interception is needed.
 */

/** macOS renders native traffic lights; Windows/Linux draw the controls. */
export const IS_MACOS =
  typeof navigator !== "undefined" && /Macintosh/i.test(navigator.userAgent);

/** Windows caption glyph weight: 10x10 px, 1px strokes. */
function CaptionIcon(props: { children: React.ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/** True while the main window is maximized or edge-tiled (fills the screen). */
export function useMainWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const invoke = invokeDesktop();
    if (!invoke) return;
    let cancelled = false;
    let frame = 0;
    // The webview resizes on drag-resize and on entering/leaving maximized;
    // throttle the maximized-state query to one per animation frame.
    const query = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void invoke("is_main_window_maximized")
          .then((value) => {
            if (!cancelled) setMaximized(value === true);
          })
          .catch(() => {});
      });
    };
    query();
    window.addEventListener("resize", query);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", query);
    };
  }, []);

  return maximized;
}

export function TitleBar() {
  const { t } = useTranslation("titlebar");
  const maximized = useMainWindowMaximized();

  if (!isDesktopApp()) return null;

  const invoke = invokeDesktop();
  const runWindowCommand = (command: string) => () => {
    void invoke?.(command).catch(() => {});
  };

  return (
    <header
      data-tauri-drag-region="deep"
      className="fixed inset-x-0 top-0 z-50 flex h-[var(--titlebar-height)] select-none max-md:hidden"
    >
      {!IS_MACOS && (
        <div className="ml-auto flex items-stretch">
          <button
            type="button"
            onClick={runWindowCommand("minimize_main_window")}
            aria-label={t("minimize")}
            className="flex w-[46px] cursor-default items-center justify-center text-muted-foreground transition-colors duration-[120ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-foreground/70"
          >
            <CaptionIcon>
              <path d="M0.5 5.5h9" />
            </CaptionIcon>
          </button>
          <button
            type="button"
            onClick={runWindowCommand("toggle_maximize_main_window")}
            aria-label={maximized ? t("restore") : t("maximize")}
            className="flex w-[46px] cursor-default items-center justify-center text-muted-foreground transition-colors duration-[120ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-foreground/70"
          >
            {maximized ? (
              <CaptionIcon>
                <rect x="0.5" y="2.5" width="7" height="7" />
                <path d="M2.5 2.5V0.5h7v7h-2" />
              </CaptionIcon>
            ) : (
              <CaptionIcon>
                <rect x="0.5" y="0.5" width="9" height="9" />
              </CaptionIcon>
            )}
          </button>
          <button
            type="button"
            onClick={runWindowCommand("close_main_window")}
            aria-label={t("close")}
            className="flex w-[46px] items-center justify-center cursor-default text-muted-foreground transition-colors duration-[120ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none hover:bg-destructive hover:text-white focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-white/70"
          >
            <CaptionIcon>
              <path d="M1 1l8 8M9 1l-8 8" />
            </CaptionIcon>
          </button>
        </div>
      )}
    </header>
  );
}
