import { workspaceLink } from "@xbond/client/workspace";
import {
  Activity,
  ArrowRight,
  Check,
  Compass,
  Copy,
  CornerDownLeft,
  FileText,
  Globe,
  HelpCircle,
  Network,
  Pin,
  Power,
  RotateCw,
  Search,
  Settings,
  Shield,
  Zap,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useProxy } from "@/features/proxies/proxy-data";
import { useNodeSelection } from "@/features/proxies/use-node-selection";
import { cn } from "@/lib/utils";
import { useLocalAPI } from "@/state/local-runtime";
import { usePinnedNodes } from "@/state/user-preferences";

export function CommandPalette() {
  const { t } = useTranslation("commandPalette");
  const { t: tc } = useTranslation("common");
  const { t: nav } = useTranslation("sidebar");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { status, up, down, restart, setMode } = useLocalAPI();
  const running = status?.engine.running ?? false;
  const { groups } = useProxy();
  const nodeSelection = useNodeSelection();
  const { isPinned } = usePinnedNodes();

  // Listen to keyboard shortcut Cmd/Ctrl + K and custom open event
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) {
            setQuery("");
            setActiveIndex(0);
          }
          return next;
        });
      }
    };
    const onCustomOpen = () => {
      setOpen(true);
      setQuery("");
      setActiveIndex(0);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onCustomOpen);
    };
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Keep active item scrolled into view
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Command items
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();

    const actions = [
      {
        id: "toggle-connection",
        category: t("categories.actions"),
        icon: Power,
        title: running ? t("actions.disconnect") : t("actions.connect"),
        subtitle: running
          ? t("actions.disconnectDesc")
          : t("actions.connectDesc"),
        action: async () => {
          if (running) {
            await down();
            toast.info(t("toasts.disconnected"));
          } else {
            await up();
            toast.success(t("toasts.connected"));
          }
        },
      },
      {
        id: "restart-core",
        category: t("categories.actions"),
        icon: RotateCw,
        title: t("actions.restart"),
        subtitle: t("actions.restartDesc"),
        action: async () => {
          await restart();
          toast.success(t("toasts.restarted"));
        },
      },
      {
        id: "mode-rule",
        category: t("categories.actions"),
        icon: Zap,
        title: t("actions.ruleMode"),
        subtitle: t("actions.ruleModeDesc"),
        action: async () => {
          await setMode({ routing: "rule" });
          toast.success(
            t("toasts.switchedMode", {
              mode: tc("routingMode.rule") || "Rule",
            }),
          );
        },
      },
      {
        id: "mode-global",
        category: t("categories.actions"),
        icon: Globe,
        title: t("actions.globalMode"),
        subtitle: t("actions.globalModeDesc"),
        action: async () => {
          await setMode({ routing: "global" });
          toast.success(
            t("toasts.switchedMode", {
              mode: tc("routingMode.global") || "Global",
            }),
          );
        },
      },
      {
        id: "mode-direct",
        category: t("categories.actions"),
        icon: ArrowRight,
        title: t("actions.directMode"),
        subtitle: t("actions.directModeDesc"),
        action: async () => {
          await setMode({ routing: "direct" });
          toast.success(
            t("toasts.switchedMode", {
              mode: tc("routingMode.direct") || "Direct",
            }),
          );
        },
      },
      {
        id: "copy-env",
        category: t("categories.actions"),
        icon: Copy,
        title: t("actions.copyEnv"),
        subtitle: t("actions.copyEnvDesc"),
        action: async () => {
          const port = status?.engine.mixedPort || 7890;
          const cmd = `export http_proxy=http://127.0.0.1:${port} https_proxy=http://127.0.0.1:${port}`;
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(cmd);
            toast.success(t("toasts.envCopied"));
          }
        },
      },
    ];

    const navigation = [
      {
        id: "nav-connect",
        category: t("categories.navigation"),
        icon: Compass,
        title: nav("home") || "Home",
        path: "/",
      },
      {
        id: "nav-proxies",
        category: t("categories.navigation"),
        icon: Network,
        title: nav("proxies") || "Proxies",
        path: "/proxies",
      },
      {
        id: "nav-config",
        category: t("categories.navigation"),
        icon: FileText,
        title: nav("subscriptions") || "Config",
        path: "/config",
      },
      {
        id: "nav-connections",
        category: t("categories.navigation"),
        icon: Activity,
        title: nav("connections") || "Connections",
        path: "/connections",
      },
      {
        id: "nav-rules",
        category: t("categories.navigation"),
        icon: Shield,
        title: nav("rules") || "Rules",
        path: "/rules",
      },
      {
        id: "nav-logs",
        category: t("categories.navigation"),
        icon: FileText,
        title: nav("logs") || "Logs",
        path: "/logs",
      },
      {
        id: "nav-diagnostics",
        category: t("categories.navigation"),
        icon: HelpCircle,
        title: nav("diagnostics") || "Diagnostics",
        path: "/diagnostics",
      },
      {
        id: "nav-settings",
        category: t("categories.navigation"),
        icon: Settings,
        title: nav("settings") || "Settings",
        path: "/settings",
      },
    ].map((item) => ({
      ...item,
      subtitle: t("navSubtitle", { title: item.title }),
      action: async () => {
        navigate(workspaceLink(location.search, item.path));
      },
    }));

    // Filter nodes from the first primary selector group (e.g. PROXY or GLOBAL)
    const primaryGroup = groups.find((g) => g.type === "Selector") ?? groups[0];
    const allGroupNodes = primaryGroup?.all ?? [];
    const pinnedNodes = allGroupNodes.filter(isPinned);
    const normalNodes = allGroupNodes.filter((n) => !isPinned(n));
    const sortedGroupNodes = [...pinnedNodes, ...normalNodes];

    const nodeItems = sortedGroupNodes.slice(0, 40).map((nodeName) => {
      const pinned = isPinned(nodeName);
      return {
        id: `node-${nodeName}`,
        category: pinned
          ? t("categories.pinned")
          : `${t("categories.nodes")} (${primaryGroup?.name ?? "PROXY"})`,
        icon: pinned ? Pin : Check,
        title: nodeName,
        subtitle:
          nodeName === primaryGroup?.now ? t("nodeCurrent") : t("nodeSelect"),
        action: async () => {
          if (primaryGroup) {
            await nodeSelection.select(primaryGroup.name, nodeName);
            toast.success(t("toasts.nodeSwitched", { node: nodeName }));
          }
        },
      };
    });

    const all = [...actions, ...navigation, ...nodeItems];
    if (!q) return all.slice(0, 20);

    return all
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [
    query,
    t,
    running,
    down,
    up,
    restart,
    setMode,
    tc,
    status,
    nav,
    navigate,
    location.search,
    groups,
    isPinned,
    nodeSelection,
  ]);

  const handleSelect = async (index: number) => {
    const item = items[index];
    if (item) {
      setOpen(false);
      try {
        await item.action();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(
        (prev) => (prev - 1 + items.length) % Math.max(1, items.length),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      void handleSelect(activeIndex);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActiveIndex(0);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="fixed top-[15%] sm:top-[18%] left-[50%] translate-x-[-50%] translate-y-0 w-full max-w-xl p-0 overflow-hidden rounded-2xl border border-border/80 bg-popover/95 shadow-elevation-raised backdrop-blur-2xl ring-1 ring-white/10 dark:ring-white/5"
      >
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>

        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border/60 bg-surface-inset/30 px-4 py-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-brand" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("searchPlaceholder")}
            className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md border border-border/80 bg-card px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shadow-xs">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto p-2 [scrollbar-width:thin]">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center select-none">
              <div className="grid size-10 place-items-center rounded-full bg-surface-inset text-muted-foreground mb-3">
                <Search className="size-5 opacity-60" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {t("emptyTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("emptyDesc")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === activeIndex;
                const isFirstInCategory =
                  idx === 0 || items[idx - 1].category !== item.category;

                return (
                  <React.Fragment key={item.id}>
                    {isFirstInCategory && (
                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase select-none first:pt-1">
                        {item.category}
                      </div>
                    )}
                    <button
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      type="button"
                      onClick={() => void handleSelect(idx)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        "group relative flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-brand/10 text-foreground ring-1 ring-brand/20 dark:bg-brand/15"
                          : "text-foreground/90 hover:bg-surface-inset/80 hover:text-foreground",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                            isSelected
                              ? "bg-brand text-brand-foreground shadow-xs"
                              : "bg-surface-inset text-muted-foreground border border-border/40 group-hover:bg-muted",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium leading-tight">
                            {item.title}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground/80 mt-0.5 leading-tight">
                            {item.subtitle}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-brand shrink-0 ml-2 animate-in fade-in-50 duration-150">
                          <span className="text-[10px] font-mono opacity-80">
                            {t("footer.select")}
                          </span>
                          <CornerDownLeft className="size-3.5" />
                        </div>
                      )}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer toolbar */}
        <div className="flex items-center justify-between border-t border-border/60 bg-surface-inset/30 px-4 py-2 text-[11px] text-muted-foreground select-none">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border/80 bg-card px-1 py-0.5 font-mono text-[9px] shadow-xs">
                ↑↓
              </kbd>
              <span>{t("footer.navigate")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border/80 bg-card px-1 py-0.5 font-mono text-[9px] shadow-xs">
                ↵
              </kbd>
              <span>{t("footer.select")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-border/80 bg-card px-1 py-0.5 font-mono text-[9px] shadow-xs">
                esc
              </kbd>
              <span>{t("footer.close")}</span>
            </span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/60">
            {items.length} {t("categories.nodes")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
