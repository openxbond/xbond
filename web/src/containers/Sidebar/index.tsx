import { XBondIcon } from "@components";
import { type Lang, type Language } from "@i18n";
import { DASHBOARD_VERSION, parseClientInfo } from "@lib/version";
import { useI18n, useVersion, useClashXData } from "@stores";
import classnames from "classnames";
import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";

import "./style.scss";

interface SidebarProps {
  routes: Array<{
    path: string;
    name: string;
    noMobile?: boolean;
  }>;
}

function getRouteIcon(name: string) {
  switch (name) {
    case "Connect":
      return (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />
        </svg>
      );
    case "Proxies":
      return (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
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
    case "Activity":
      return (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="nav-icon"
          aria-hidden="true"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "Settings":
      return (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
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

export default function Sidebar(props: SidebarProps) {
  const { routes } = props;
  const { translation } = useI18n();
  const { version, premium, meta } = useVersion();
  const { data } = useClashXData();
  const { t } = translation("SideBar");
  const { t: ui } = translation("ClientUI");
  const location = useLocation();

  const clientInfo = useMemo(
    () => parseClientInfo(version, data?.isClashX, premium, meta),
    [version, data?.isClashX, premium, meta],
  );

  const navlinks = routes.map(({ path, name, noMobile }) => (
    <li className={classnames("item", { "no-mobile": noMobile })} key={name}>
      <NavLink
        to={{ pathname: path, search: location.search }}
        className={({ isActive }) => classnames({ active: isActive })}
      >
        {getRouteIcon(name)}
        <span className="nav-label">
          {name === "Connect"
            ? ui("home")
            : name === "Proxies"
              ? ui("proxies")
              : t(name as keyof (typeof Language)[Lang]["SideBar"])}
        </span>
      </NavLink>
    </li>
  ));

  return (
    <nav className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-brand">
        <XBondIcon className="sidebar-logo" />
        <span className="sidebar-brand-name">XBond</span>
      </div>
      <ul className="sidebar-menu">{navlinks}</ul>
      <div className="sidebar-version">
        <div className="sidebar-version-item">
          <span className="sidebar-version-label">{clientInfo.type}</span>
          <span className="sidebar-version-text">
            {clientInfo.version || "--"}
          </span>
        </div>
        <div className="sidebar-version-item">
          <span className="sidebar-version-label">Dashboard</span>
          <span className="sidebar-version-text">v{DASHBOARD_VERSION}</span>
        </div>
      </div>
    </nav>
  );
}
