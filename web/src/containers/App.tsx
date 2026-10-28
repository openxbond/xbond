import Activity from "@containers/Activity";
import Connect from "@containers/Connect";
import ExternalControllerModal from "@containers/ExternalControllerDrawer";
import Proxies from "@containers/Proxies";
import Settings from "@containers/Settings";
import SideBar from "@containers/Sidebar";
import { isClashX } from "@lib/jsBridge";
import { detectLocalAPIConfig, isDesktopApp } from "@lib/localapi";
import { workspaceLink } from "@lib/workspace";
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

  const routes = [
    { path: "/connect", name: "Connect", element: <Connect /> },
    { path: "/proxies", name: "Proxies", element: <Proxies /> },
    { path: "/activity", name: "Activity", element: <Activity /> },
    { path: "/settings", name: "Settings", element: <Settings /> },
  ];

  const layout = (
    <div className={classnames("app", { "not-clashx": !isClashX() })}>
      <SideBar routes={routes} />
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
        {/* Four Primary Routes */}
        {routes.map((route) => (
          <Route path={route.path} key={route.path} element={route.element} />
        ))}
        {/* Backward Compatibility Redirects */}
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
          path="/diagnostics"
          element={
            <Navigate
              to={workspaceLink(location.search, "/settings", {
                section: "diagnostics",
              })}
              replace
            />
          }
        />
        <Route
          path="/connections"
          element={
            <Navigate
              to={workspaceLink(location.search, "/activity", {
                view: "connections",
              })}
              replace
            />
          }
        />
        <Route
          path="/logs"
          element={
            <Navigate
              to={workspaceLink(location.search, "/activity", { view: "logs" })}
              replace
            />
          }
        />
        <Route
          path="/rules"
          element={
            <Navigate
              to={workspaceLink(location.search, "/settings", {
                section: "rules",
              })}
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
