import { XBondIcon } from "@components";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import { identityAtom, useStreamReader, useStreamState } from "@stores";
import { workspaceLink } from "@xbond/client/workspace";
import { useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { AccountMenu } from "./AccountMenu";
import { ControllerSwitcher } from "./ControllerSwitcher";

import "./style.scss";

/** Route display names map to sidebar message keys (desktop 8 + mobile 4). */
function navLabel(name: string) {
  const keys = {
    Connect: "home",
    Proxies: "proxies",
    Subscriptions: "subscriptions",
    Connections: "connections",
    Rules: "rules",
    Logs: "logs",
    Diagnostics: "diagnostics",
    Activity: "activity",
    Settings: "settings",
  } as const;
  return keys[name as keyof typeof keys] ?? "home";
}

interface SidebarProps {
  routes: Array<{
    path: string;
    name: string;
  }>;
}

function getRouteIcon(name: string) {
  switch (name) {
    case "Connect":
      // 首頁入口用屋形，與流動底欄一致；電源符號保留給連線主操作。
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M9 21v-8h6v8" />
        </svg>
      );
    case "Proxies":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      );
    case "Subscriptions":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "Connections":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="M8 8h8v8H8zM4 4h3v3H4zM17 4h3v3h-3zM4 17h3v3H4zM17 17h3v3h-3zM7 7l2 2M15 9l2-2M7 17l2-2M15 15l2 2" />
        </svg>
      );
    case "Rules":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
      );
    case "Logs":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          <line x1="8" y1="6" x2="16" y2="6" />
          <line x1="8" y1="10" x2="16" y2="10" />
        </svg>
      );
    case "Diagnostics":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 15h8" />
        </svg>
      );
    case "Activity":
      // 活動頁以長條圖表達「用量監察」，與舊脈衝線區分。
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="18" y1="20" x2="18" y2="10" />
        </svg>
      );
    case "Settings":
      return (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}

function NavLink({
  item,
  compact,
}: {
  item: { path: string; name: string };
  compact?: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === item.path;
  const { t } = useTranslation("sidebar");
  const label = t(navLabel(item.name));
  return (
    <li className="item">
      <Link
        to={workspaceLink(location.search, item.path)}
        className={isActive ? "active" : undefined}
        aria-current={isActive ? "page" : undefined}
        aria-label={compact ? label : undefined}
      >
        {getRouteIcon(item.name)}
        <span className="nav-label">{label}</span>
      </Link>
    </li>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { routes } = props;
  const { t } = useTranslation("sidebar");
  const setIdentity = useSetAtom(identityAtom);
  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);

  // 无 daemon 的纯前端只通过远程控制器管理：不出现订阅入口（App 同步重定向）。
  const daemonConfigured = hasDaemonConfig();
  const desktopItems = [
    { path: "/connect", name: "Connect" },
    { path: "/proxies", name: "Proxies" },
    { path: "/subscriptions", name: "Subscriptions" },
    { path: "/connections", name: "Connections" },
    { path: "/rules", name: "Rules" },
    { path: "/logs", name: "Logs" },
    { path: "/diagnostics", name: "Diagnostics" },
    { path: "/settings", name: "Settings" },
  ].filter((item) => !(!daemonConfigured && item.name === "Subscriptions"));

  return (
    <>
      {/* 流動頂欄：品牌、控制目標與帳號常駐（client-experience-proposal §5）。 */}
      <header className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <XBondIcon className="mobile-topbar-logo" />
          <span className="mobile-topbar-name">XBond</span>
        </div>
        <ControllerSwitcher
          connected={trafficState === "open"}
          onEdit={() => setIdentity(false)}
        />
        <div className="mobile-topbar-account">
          <AccountMenu variant="avatar" />
        </div>
      </header>

      {/* 桌面玻璃浮島側欄 */}
      <nav className="sidebar" aria-label={t("home")}>
        <div className="sidebar-brand">
          <XBondIcon className="sidebar-logo" />
          <span className="sidebar-brand-name">XBond</span>
        </div>

        <div className="sidebar-target">
          <ControllerSwitcher
            connected={trafficState === "open"}
            onEdit={() => setIdentity(false)}
          />
        </div>

        <ul className="sidebar-menu">
          {desktopItems.map((item) => (
            <NavLink key={item.name} item={item} />
          ))}
        </ul>

        <div className="sidebar-footer">
          <AccountMenu variant="row" />
        </div>
      </nav>

      {/* 流動底部浮島：四項主入口（首頁／節點／活動／設定）。 */}
      <nav className="mobile-island" aria-label={t("home")}>
        <ul className="mobile-island-menu">
          {routes.map(({ path, name }) => (
            <NavLink key={name} item={{ path, name }} compact />
          ))}
        </ul>
      </nav>
    </>
  );
}
