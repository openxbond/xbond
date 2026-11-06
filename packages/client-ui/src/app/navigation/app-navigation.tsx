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

export type RouteName = keyof typeof routeMeta;

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

/**
 * 側欄行：緊湊的 source-list 行。選中用品牌左軌、淺橙底與品牌圖示，
 * 其餘保持中性；品牌橙不鋪滿整行。
 */
function SidebarLink({ item }: { item: Route }) {
  const { active, Icon, to, text } = useRouteLink(item);
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-h-10 items-center gap-2.5 rounded-[12px] border border-transparent px-2.5 text-[13px] font-medium text-sidebar-foreground-muted no-underline transition-[background-color,color,box-shadow,border-color] duration-150 motion-reduce:transition-none",
          active
            ? "border border-[var(--glass-border)] bg-white/45 text-foreground shadow-[0_8px_20px_-14px_oklch(0.2_0.03_265/45%)] before:absolute before:inset-y-2.5 before:start-0 before:w-[3px] before:rounded-full before:bg-brand before:content-[''] dark:bg-white/10"
            : "hover:bg-white/45 hover:text-foreground dark:hover:bg-white/10",
        )}
      >
        <Icon
          aria-hidden
          className={cn("size-[17px] shrink-0", active && "text-foreground")}
          strokeWidth={1.8}
        />
        <span className="min-w-0 truncate">{text}</span>
      </Link>
    </li>
  );
}

/** 底部標籤：iOS 只變色；Android 在圖示後加 M3 膠囊指示。 */
function TabLink({ item }: { item: Route }) {
  const { active, Icon, to, text } = useRouteLink(item);
  return (
    <li className="min-w-0 flex-1">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-0.5 text-label font-medium no-underline",
          active ? "text-brand-text" : "text-sidebar-foreground-muted",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-12 place-items-center rounded-full transition-colors motion-reduce:transition-none",
            active && "host-android:bg-brand-soft",
          )}
        >
          <Icon aria-hidden className="size-[22px]" strokeWidth={1.8} />
        </span>
        <span className="max-w-full truncate px-1">{text}</span>
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
      className="glass-bar flex w-[var(--sidebar-width)] shrink-0 flex-col overflow-hidden rounded-[22px] text-sidebar-foreground select-none max-md:hidden"
    >
      {isDesktopApp() && (
        <div
          data-tauri-drag-region
          className="h-[var(--titlebar-height)] shrink-0"
        />
      )}
      <div
        data-tauri-drag-region="deep"
        className="flex h-16 shrink-0 items-center gap-2.5 px-4"
      >
        <XBondIcon className="size-[22px] shrink-0" />
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
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
        <div
          className="mx-2 my-2 h-px bg-[var(--glass-border)]"
          aria-hidden="true"
        />
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {inspectRoutes.map((item) => (
            <SidebarLink key={item.name} item={item} />
          ))}
        </ul>
        <ul className="m-0 mt-auto flex list-none flex-col p-0">
          <SidebarLink item={settingsRoute} />
        </ul>
      </div>
      <div className="border-t border-[var(--glass-border)] p-2.5">
        <ConfigMenu />
      </div>
    </nav>
  );
}

/** 手機頂欄：品牌與設定；控制目標與帳號在配置頁。 */
function MobileTopBar() {
  const { t } = useTranslation("sidebar");
  const location = useLocation();
  return (
    <header className="glass-bar fixed inset-x-0 top-0 z-50 hidden h-[calc(var(--topbar-height)+env(safe-area-inset-top))] items-center gap-2.5 rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)] ps-4 pe-2 max-md:flex">
      <XBondIcon className="size-6 shrink-0" />
      <span className="text-subtitle font-semibold text-foreground">XBond</span>
      <Link
        to={workspaceLink(location.search, "/settings")}
        className="ms-auto inline-flex size-11 items-center justify-center rounded-control text-muted-foreground hover:bg-sidebar-accent"
        aria-label={t("settings")}
      >
        <Settings aria-hidden className="size-5" strokeWidth={1.8} />
      </Link>
    </header>
  );
}

function MobileTabBar({ routes }: { routes: Route[] }) {
  const { t } = useTranslation("sidebar");
  return (
    <nav
      aria-label={t("home")}
      className="glass-bar fixed inset-x-0 bottom-0 z-50 hidden rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] max-md:block"
    >
      <ul className="m-0 flex list-none items-stretch px-2">
        {routes.map((item) => (
          <TabLink key={item.name} item={item} />
        ))}
      </ul>
    </nav>
  );
}

export default function AppNavigation({ routes }: { routes: Route[] }) {
  return (
    <>
      <MobileTopBar />
      <DesktopSidebar />
      <MobileTabBar routes={routes} />
    </>
  );
}
