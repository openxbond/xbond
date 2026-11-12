import { workspaceLink } from "@xbond/client/workspace";
import {
  ChartNoAxesColumn,
  FlaskConical,
  House,
  Network,
  Package,
  Search,
  Server,
  Settings,
  ScrollText,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { IS_MACOS } from "@/components/title-bar";
import { XBondIcon } from "@/components/xbond-icon";
import { cn } from "@/lib/utils";
import { isDesktopApp } from "@/platform/local-api-bootstrap";

import { ConfigMenu } from "./configuration-menu";

export interface Route {
  path: string;
  name: RouteName;
}

const routeMeta = {
  Connect: { label: "home", icon: House },
  Proxies: { label: "proxies", icon: Server },
  Config: { label: "subscriptions", icon: Package },
  Connections: { label: "connections", icon: Network },
  Rules: { label: "rules", icon: Shuffle },
  Logs: { label: "logs", icon: ScrollText },
  Diagnostics: { label: "diagnostics", icon: FlaskConical },
  Activity: { label: "activity", icon: ChartNoAxesColumn },
  Settings: { label: "settings", icon: Settings },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

type RouteName = keyof typeof routeMeta;

/**
 * 桌面八入口分三組：日常（首頁、代理、配置）、排查（連線、規則、日誌、診斷）、
 * 設定固定在底部。手機四入口由 app-shell 傳入；二者由宿主決定而非視窗寬度。
 */
const dailyRoutes: Route[] = [
  { path: "/", name: "Connect" },
  { path: "/proxies", name: "Proxies" },
  { path: "/config", name: "Config" },
];
const inspectRoutes: Route[] = [
  { path: "/connections", name: "Connections" },
  { path: "/rules", name: "Rules" },
  { path: "/logs", name: "Logs" },
  { path: "/diagnostics", name: "Diagnostics" },
];
const settingsRoute: Route = { path: "/settings", name: "Settings" };

function useRouteLink(item: Route) {
  const location = useLocation();
  const { t } = useTranslation("sidebar");
  const { t: cfg } = useTranslation("configuration");
  const active =
    location.pathname === item.path ||
    (item.path === "/" && location.pathname === "/connect");
  const { label, icon } = routeMeta[item.name];
  return {
    active,
    Icon: icon,
    to: workspaceLink(location.search, item.path),
    text: item.name === "Config" ? cfg("title") : t(label),
  };
}

/** 行尾品牌橙呼吸點：實心點帶輝光，擴散環只在允許動態時出現。 */
function BreathingDot() {
  return (
    <span
      aria-hidden="true"
      className="relative flex size-2 shrink-0 items-center justify-center"
    >
      <span className="absolute size-full rounded-full bg-brand opacity-60 motion-safe:animate-ping" />
      <span className="relative size-1.5 rounded-full bg-brand shadow-[0_0_6px_var(--brand)]" />
    </span>
  );
}

/**
 * 側欄行：激活項為浮起白卡（對齊 cloud 控制台的浮雕島語言），
 * 行尾嵌品牌橙呼吸點；其餘保持中性，品牌橙只出現在圖示與呼吸點。
 */
function SidebarLink({ item }: { item: Route }) {
  const { active, Icon, to, text } = useRouteLink(item);
  return (
    <li className="relative ps-1.5">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-h-10 items-center gap-2.5 rounded-control border px-3 text-sm xl:min-h-12 xl:text-body font-medium text-sidebar-foreground-muted no-underline transition-[background-color,color,box-shadow,border-color] duration-150 motion-reduce:transition-none",
          active
            ? "border-border/80 bg-white font-semibold text-foreground shadow-xs dark:border-white/15 dark:bg-white/12"
            : "border-transparent hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        <Icon
          aria-hidden
          className={cn("size-5 shrink-0", active ? "text-brand" : undefined)}
          strokeWidth={1.8}
        />
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {active && <BreathingDot />}
      </Link>
    </li>
  );
}

function SearchTrigger() {
  const { t } = useTranslation("commandPalette");
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("open-command-palette"))
      }
      className="ms-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      aria-label={t("searchButton")}
      title={`${t("searchButton")} (${IS_MACOS ? "⌘K" : "Ctrl K"})`}
    >
      <Search aria-hidden className="size-4" strokeWidth={1.8} />
    </button>
  );
}

function DesktopSidebar() {
  const { t } = useTranslation("sidebar");
  return (
    <nav
      aria-label={t("home")}
      className="glass-bar flex w-[var(--sidebar-width)] shrink-0 flex-col rounded-hero text-sidebar-foreground select-none max-md:hidden"
    >
      {isDesktopApp() && (
        <div
          data-tauri-drag-region
          className="h-[var(--titlebar-height)] shrink-0"
        />
      )}
      <div
        data-tauri-drag-region="deep"
        className="flex h-14 shrink-0 items-center gap-2.5 px-4 xl:h-18"
      >
        <XBondIcon className="size-6 shrink-0" />
        <span className="text-title font-bold tracking-tight text-foreground">
          XBond
        </span>
        <SearchTrigger />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-1 pb-2">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {dailyRoutes.map((item) => (
            <SidebarLink key={item.name} item={item} />
          ))}
        </ul>
        <div className="mx-2 my-2 h-px bg-sidebar-border" aria-hidden="true" />
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {inspectRoutes.map((item) => (
            <SidebarLink key={item.name} item={item} />
          ))}
        </ul>
        <div className="mx-2 my-2 h-px bg-sidebar-border" aria-hidden="true" />
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          <SidebarLink item={settingsRoute} />
        </ul>
      </div>
      <div className="p-2.5">
        <ConfigMenu />
      </div>
    </nav>
  );
}

/**
 * 底部四 Tab（首頁、代理、配置、設定）的二級路由回退：
 * 連線／日誌／規則／診斷等排查工具皆由設定頁進入，亮著「設定」入口。
 */
const mobileTabFallbacks: Partial<Record<RouteName, string[]>> = {
  Connect: ["/overview"],
  Proxies: [],
  Config: ["/subscriptions"],
  Settings: ["/connections", "/rules", "/logs", "/diagnostics", "/activity"],
};

function MobileTabLink({ item }: { item: Route }) {
  const { Icon, to, text } = useRouteLink(item);
  const location = useLocation();
  const active =
    location.pathname === item.path ||
    (item.path === "/" && location.pathname === "/connect") ||
    (mobileTabFallbacks[item.name]?.includes(location.pathname) ?? false);
  return (
    <li className="min-w-0 flex-1">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-0.5 text-label font-medium no-underline",
          active
            ? "font-semibold text-brand-text"
            : "text-sidebar-foreground-muted",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-12 place-items-center rounded-full transition-colors motion-reduce:transition-none",
            active ? "bg-brand-soft" : "border border-transparent",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "size-[22px]",
              active ? "text-brand-text" : undefined,
            )}
            strokeWidth={1.8}
          />
        </span>
        <span className="max-w-full truncate px-1">{text}</span>
      </Link>
    </li>
  );
}

function MobileTabBar({ routes }: { routes: Route[] }) {
  const { t } = useTranslation("sidebar");
  return (
    <nav
      aria-label={t("home")}
      className="glass-bar glass-bar-solid fixed inset-x-0 bottom-0 z-50 hidden rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] max-md:block"
    >
      <ul className="m-0 flex list-none items-stretch px-2">
        {routes.map((item) => (
          <MobileTabLink key={item.name} item={item} />
        ))}
      </ul>
    </nav>
  );
}

export default function AppNavigation({ routes }: { routes: Route[] }) {
  return (
    <>
      <DesktopSidebar />
      <MobileTabBar routes={routes} />
    </>
  );
}
