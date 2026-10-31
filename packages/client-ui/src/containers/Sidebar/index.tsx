import { XBondIcon } from "@components";
import { DASHBOARD_VERSION, parseClientInfo } from "@lib/version";
import { DESKTOP_NAV, MOBILE_NAV, type NavName } from "@nav";
import {
  useVersion,
  useClashXData,
  identityAtom,
  useStreamReader,
  useStreamState,
} from "@stores";
import { formatRate } from "@xbond/client/activity";
import { workspaceLink } from "@xbond/client/workspace";
import { useSetAtom } from "jotai";
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { AccountMenu } from "./AccountMenu";
import { ControllerSwitcher } from "./ControllerSwitcher";

import "./style.scss";

/** Route display names map to sidebar message keys. */
export function navLabel(name: NavName) {
  const keys = {
    Connect: "connect",
    Activity: "activity",
    Proxies: "proxies",
    Subscriptions: "subscriptions",
    Settings: "settings",
  } as const;
  return keys[name];
}

function getRouteIcon(name: NavName) {
  switch (name) {
    case "Connect":
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
          <path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0" />
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
    case "Activity":
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
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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

export default function Sidebar() {
  const { version, premium, meta } = useVersion();
  const { data } = useClashXData();
  const { t } = useTranslation("sidebar");
  const location = useLocation();
  const setIdentity = useSetAtom(identityAtom);

  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);

  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      setSpeed(items.at(-1) ?? null);
    };
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);

  const clientInfo = useMemo(
    () => parseClientInfo(version, data?.isClashX, premium, meta),
    [version, data?.isClashX, premium, meta],
  );

  const desktopLinks = DESKTOP_NAV.map(({ path, name }) => {
    const isActive = location.pathname === path;
    return (
      <li className="item" key={name}>
        <Link
          to={workspaceLink(location.search, path)}
          className={isActive ? "active" : undefined}
          aria-current={isActive ? "page" : undefined}
        >
          {getRouteIcon(name)}
          <span className="nav-label">{t(navLabel(name))}</span>
        </Link>
      </li>
    );
  });

  const mobileLinks = MOBILE_NAV.map(({ path, name }) => {
    const isActive = location.pathname === path;
    return (
      <li className="item" key={name}>
        <Link
          to={workspaceLink(location.search, path)}
          className={isActive ? "active" : undefined}
          aria-current={isActive ? "page" : undefined}
        >
          {getRouteIcon(name)}
          <span className="nav-label">{t(navLabel(name))}</span>
        </Link>
      </li>
    );
  });

  return (
    <nav className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-brand">
        <XBondIcon className="sidebar-logo" />
        <span className="sidebar-brand-name">XBond</span>
      </div>

      <ul className="sidebar-menu desktop-menu">{desktopLinks}</ul>
      <ul className="sidebar-menu mobile-menu">{mobileLinks}</ul>

      <div className="sidebar-footer">
        {trafficState === "open" && speed && (
          <div className="sidebar-telemetry">
            <div className="telemetry-item down">
              <span className="arrow" aria-hidden="true">
                &darr;
              </span>
              <span className="rate">{formatRate(speed.down)}</span>
            </div>
            <div className="telemetry-item up">
              <span className="arrow" aria-hidden="true">
                &uarr;
              </span>
              <span className="rate">{formatRate(speed.up)}</span>
            </div>
          </div>
        )}

        {/* Target switcher and the account avatar are always visible: the
            desktop footer stacks them vertically; on mobile the footer
            becomes the slim row above the bottom tabs. */}
        <div className="sidebar-footer-controls">
          <ControllerSwitcher
            connected={trafficState === "open"}
            onEdit={() => setIdentity(false)}
          />
          <AccountMenu />
        </div>

        <div className="sidebar-version">
          <div className="sidebar-version-item">
            <span className="sidebar-version-label">{clientInfo.type}</span>
            <span className="sidebar-version-text">
              {clientInfo.version || "--"}
            </span>
          </div>
          <div className="sidebar-version-item">
            <span className="sidebar-version-label">app</span>
            <span className="sidebar-version-text">{DASHBOARD_VERSION}</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
