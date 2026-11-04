import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { invokeDesktop, isDesktopApp } from "@/platform/local-api-bootstrap";
import { useLanguage } from "@/state/user-preferences";

/**
 * Desktop-shell integration for the webview side: removes browser residue
 * (native right-click menu, text selection on chrome, file-drop navigation),
 * reveals the window after first render (anti-flash), polls the shell for
 * deep-link imports, and prompts when the clipboard holds an importable
 * subscription. Everything here is desktop-only and inert in web hosts.
 */

export interface ImportCandidate {
  kind: "share" | "url";
  value: string;
}

const SHARE_LINK = /^(ss|ssr|vmess|vless|trojan|hysteria|hysteria2|tuic):\/\//i;
const BARE_URL = /^https?:\/\/\S+$/i;
const CONFIG_SUFFIX = /\.(yaml|yml)$/i;
const SUBSCRIPTION_HINT = /[?&](token|sub|target|flag|url|endpoint|remote)=/i;

/**
 * Conservative share-link / subscription sniffing. Anything that looks like a
 * share link qualifies; plain URLs must carry a subscription hint so a random
 * copied article link never triggers a prompt.
 */
export function detectImportCandidate(text: string): ImportCandidate | null {
  const value = text.trim();
  if (!value || value.length > 2048 || /\s/.test(value)) return null;
  if (SHARE_LINK.test(value)) return { kind: "share", value };
  if (
    BARE_URL.test(value) &&
    (CONFIG_SUFFIX.test(value) || SUBSCRIPTION_HINT.test(value))
  ) {
    return { kind: "url", value };
  }
  return null;
}

/** Import hand-off target: the config page's import detail, prefilled. */
export function importTargetParams(
  candidate: ImportCandidate,
): URLSearchParams {
  return candidate.kind === "url"
    ? new URLSearchParams({ item: "add-profile", url: candidate.value })
    : new URLSearchParams({ item: "add-profile", paste: candidate.value });
}

/**
 * DOM-level de-webification, run once before render. Inputs, textareas,
 * editable hosts and technical strings stay selectable per DESIGN.md (網址與
 * 技術字串保留完整查看或複製方式).
 */
export function initDesktopShellDom(): void {
  if (!isDesktopApp() || typeof document === "undefined") return;
  document.documentElement.classList.add("desktop-shell");
  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("input, textarea, [contenteditable='true']")) {
      event.preventDefault();
    }
  });
  // A stray file drop must not navigate the webview away from the app.
  const block = (event: DragEvent) => event.preventDefault();
  document.addEventListener("dragover", block);
  document.addEventListener("drop", block);
}

const MAX_REMEMBERED_PROMPTS = 50;
const PENDING_POLL_MS = 1200;

let promptedCandidates = new Set<string>();

function rememberPrompted(value: string): boolean {
  if (promptedCandidates.has(value)) return false;
  if (promptedCandidates.size >= MAX_REMEMBERED_PROMPTS)
    promptedCandidates = new Set();
  promptedCandidates.add(value);
  return true;
}

export function useDesktopShell(): void {
  const navigate = useNavigate();
  const { t } = useTranslation("onboarding");
  const { lang } = useLanguage();

  useEffect(() => {
    const invoke = invokeDesktop();
    if (!invoke) return;
    void invoke("set_tray_language", { lang }).catch(() => {});
  }, [lang]);

  useEffect(() => {
    const invoke = invokeDesktop();
    if (!invoke) return;
    let cancelled = false;

    // First render is committed: safe to reveal the window created with
    // visible:false (the shell falls back to showing it after 5s anyway).
    void invoke("show_main_window").catch(() => {});

    const showImportToast = (
      candidate: ImportCandidate,
      message: string,
      go: boolean,
    ) => {
      const open = () =>
        navigate({
          pathname: "/config",
          search: importTargetParams(candidate).toString(),
        });
      if (go) open();
      toast(message, {
        description:
          candidate.value.length > 96
            ? `${candidate.value.slice(0, 93)}…`
            : candidate.value,
        duration: 8000,
        ...(go
          ? {}
          : { action: { label: t("importHandoffOpen"), onClick: open } }),
      });
    };

    // Deep links queue in the shell (second instance, cold-start argv,
    // runtime URL events); the window may be hidden when they arrive, so the
    // frontend drains the queue on a short poll instead of event plumbing.
    const poll = setInterval(() => {
      void invoke("take_pending_import").then((url) => {
        if (cancelled || typeof url !== "string" || !url) return;
        showImportToast(
          { kind: "url", value: url },
          t("importHandoffDeepLink"),
          true,
        );
      });
    }, PENDING_POLL_MS);

    const onWindowFocus = () => {
      void invoke("read_clipboard_text").then((text) => {
        if (cancelled || typeof text !== "string") return;
        const candidate = detectImportCandidate(text);
        if (!candidate || !rememberPrompted(candidate.value)) return;
        showImportToast(candidate, t("importHandoffClipboard"), false);
      });
    };
    window.addEventListener("focus", onWindowFocus);

    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [navigate, t]);
}
