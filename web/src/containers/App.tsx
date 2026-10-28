import Activity from "@containers/Activity";
import Connect from "@containers/Connect";
import Connections from "@containers/Connections";
import Diagnostics from "@containers/Diagnostics";
import ExternalControllerModal from "@containers/ExternalControllerDrawer";
import Logs from "@containers/Logs";
import Proxies from "@containers/Proxies";
import Rules from "@containers/Rules";
import Settings from "@containers/Settings";
import SideBar from "@containers/Sidebar";
import Subscriptions from "@containers/Subscriptions";
import { isClashX } from "@lib/jsBridge";
import { detectLocalAPIConfig, isDesktopApp } from "@lib/localapi";
import { useClient, useTheme } from "@stores";
import classnames from "classnames";
import { Route, Navigate, Routes, useLocation, Outlet } from "react-router-dom";

import "../styles/common.scss";
import "../styles/iconfont.scss";

export default function App() {
  const client = useClient();
  useTheme();

  const location = useLocation();
  const initialPage =
    detectLocalAPIConfig() || isDesktopApp() ? "/connect" : "/proxies";

  // Mobile bottom navigation targets (4 core destinations)
  const mobileRoutes = [
    { path: "/connect", name: "Connect" },
    { path: "/proxies", name: "Proxies" },
    { path: "/activity", name: "Activity" },
    { path: "/settings", name: "Settings" },
  ];

  const layout = (
    <div className={classnames("app", { "not-clashx": !isClashX() })}>
      <SideBar routes={mobileRoutes} />
      <div className="page-container">
        <ControllerPage key={client.id} />
      </div>
      <ExternalControllerModal />
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={layout}>
        <Route
          path="/"
          element={
            <Navigate
              to={{
                pathname: initialPage,
                search: location.search,
              }}
              replace
            />
          }
        />

        {/* 8 Distinct Dedicated Routes */}
        <Route path="/connect" element={<Connect />} />
        <Route path="/proxies" element={<Proxies />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route path="/settings" element={<Settings />} />

        {/* Mobile Activity Hub */}
        <Route path="/activity" element={<Activity />} />

        {/* Fallback Redirects */}
        <Route
          path="/overview"
          element={
            <Navigate
              to={{
                pathname: "/connect",
                search: location.search,
              }}
              replace
            />
          }
        />
        <Route
          path="*"
          element={
            <Navigate
              to={{
                pathname: "/connect",
                search: location.search,
              }}
              replace
            />
          }
        />
      </Route>
    </Routes>
  );
}

function ControllerPage() {
  return <Outlet />;
}
