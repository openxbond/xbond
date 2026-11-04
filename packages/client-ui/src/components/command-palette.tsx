import { workspaceLink } from "@xbond/client/workspace";
import {
  Activity,
  ArrowRight,
  Check,
  Compass,
  Copy,
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
import { useEffect, useMemo, useRef, useState } from "react";
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
  const { t: conn } = useTranslation("connect");
  const { t: nav } = useTranslation("sidebar");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Command items
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();

    const actions = [
      {
        id: "toggle-connection",
        category: "Actions",
        icon: Power,
        title: running ? conn("disconnect") : conn("connect"),
        subtitle: running ? "中斷當前代理連線" : "啟動核心並接管網絡",
        action: async () => {
          if (running) {
            await down();
            toast.info("已中斷連線");
          } else {
            await up();
            toast.success("已建立連線");
          }
        },
      },
      {
        id: "restart-core",
        category: "Actions",
        icon: RotateCw,
        title: "重啟核心",
        subtitle: "重新載入核心配置並恢復連線",
        action: async () => {
          await restart();
          toast.success("核心已重啟");
        },
      },
      {
        id: "mode-rule",
        category: "Actions",
        icon: Zap,
        title: "切換為規則分流模式",
        subtitle: "按分流規則自動選路",
        action: async () => {
          await setMode({ routing: "rule" });
          toast.success("已切換為規則模式");
        },
      },
      {
        id: "mode-global",
        category: "Actions",
        icon: Globe,
        title: "切換為全局代理模式",
        subtitle: "所有出站流量皆經由選定節點代理",
        action: async () => {
          await setMode({ routing: "global" });
          toast.success("已切換為全局模式");
        },
      },
      {
        id: "mode-direct",
        category: "Actions",
        icon: ArrowRight,
        title: "切換為直連模式",
        subtitle: "繞過代理，直接連線目標伺服器",
        action: async () => {
          await setMode({ routing: "direct" });
          toast.success("已切換為直連模式");
        },
      },
      {
        id: "copy-env",
        category: "Actions",
        icon: Copy,
        title: "複製終端代理命令",
        subtitle: "快速配置 HTTP / HTTPS 代理環境變數",
        action: async () => {
          const port = status?.engine.mixedPort || 7890;
          const cmd = `export http_proxy=http://127.0.0.1:${port} https_proxy=http://127.0.0.1:${port}`;
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(cmd);
            toast.success("代理命令已複製到剪貼簿");
          }
        },
      },
    ];

    const navigation = [
      {
        id: "nav-connect",
        category: "Navigation",
        icon: Compass,
        title: nav("home") || "首頁",
        path: "/connect",
      },
      {
        id: "nav-proxies",
        category: "Navigation",
        icon: Network,
        title: nav("proxies") || "節點",
        path: "/proxies",
      },
      {
        id: "nav-config",
        category: "Navigation",
        icon: FileText,
        title: nav("subscriptions") || "配置",
        path: "/config",
      },
      {
        id: "nav-connections",
        category: "Navigation",
        icon: Activity,
        title: nav("connections") || "活躍連線",
        path: "/connections",
      },
      {
        id: "nav-rules",
        category: "Navigation",
        icon: Shield,
        title: nav("rules") || "分流規則",
        path: "/rules",
      },
      {
        id: "nav-logs",
        category: "Navigation",
        icon: FileText,
        title: nav("logs") || "日誌",
        path: "/logs",
      },
      {
        id: "nav-diagnostics",
        category: "Navigation",
        icon: HelpCircle,
        title: nav("diagnostics") || "診斷",
        path: "/diagnostics",
      },
      {
        id: "nav-settings",
        category: "Navigation",
        icon: Settings,
        title: nav("settings") || "設定",
        path: "/settings",
      },
    ].map((item) => ({
      ...item,
      subtitle: `前往 ${item.title} 頁面`,
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
          ? `已釘選節點`
          : `節點 (${primaryGroup?.name ?? "PROXY"})`,
        icon: pinned ? Pin : Check,
        title: nodeName,
        subtitle:
          nodeName === primaryGroup?.now ? "目前選中" : "點擊切換為此節點",
        action: async () => {
          if (primaryGroup) {
            await nodeSelection.select(primaryGroup.name, nodeName);
            toast.success(`已切換至 ${nodeName}`);
          }
        },
      };
    });

    const all = [...actions, ...navigation, ...nodeItems];
    if (!q) return all.slice(0, 16);

    return all
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q),
      )
      .slice(0, 16);
  }, [
    query,
    running,
    conn,
    down,
    up,
    restart,
    setMode,
    status,
    nav,
    navigate,
    location.search,
    groups,
    nodeSelection,
    isPinned,
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
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-card border-border/80 bg-card/98 shadow-2xl backdrop-blur-xl">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="搜尋命令、節點或前往頁面 (↑↓ 選擇，Enter 執行)..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex rounded border border-border/80 bg-surface-inset px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto p-2 [scrollbar-width:thin]">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              未找到相關命令或節點
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {items.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleSelect(idx)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between rounded-control px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "bg-brand/10 text-brand-text"
                        : "text-foreground hover:bg-surface-inset/70",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "grid size-7 place-items-center rounded-control",
                          isSelected
                            ? "bg-brand text-brand-foreground"
                            : "bg-surface-inset text-muted-foreground",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">
                          {item.title}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground ml-2 shrink-0">
                      {item.category}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
