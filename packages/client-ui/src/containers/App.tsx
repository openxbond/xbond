import { Toaster } from "@components/ui/sonner";
import Activity from "@containers/Activity";
import Config from "@containers/Config";
import Connect from "@containers/Connect";
import Connections from "@containers/Connections";
import Diagnostics from "@containers/Diagnostics";
import Logs from "@containers/Logs";
import Proxies from "@containers/Proxies";
import Rules from "@containers/Rules";
import Settings from "@containers/Settings";
import SideBar from "@containers/Sidebar";
import { isClashX } from "@lib/jsBridge";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import { cn } from "@lib/utils";
import { identityAtom, useAPIInfo, useLocalAPI, useTheme } from "@stores";
import { useAtom } from "jotai";
import { useEffect } from "react";
import {
  Route,
  Navigate,
  Routes,
  useLocation,
  Outlet,
  useNavigate,
} from "react-router-dom";

export default function App() {
  useTheme();

  const { status, daemonState } = useLocalAPI();
  const [identity, setIdentity] = useAtom(identityAtom);
  const target = useAPIInfo();
  const location = useLocation();
  const navigate = useNavigate();
  const initialPage =
    hasDaemonConfig() && status?.activeSub ? "/connect" : "/config";
  // Pages ask for controller management by clearing the identity flag; send
  // them to the matching detail instead of reviving the removed modal.
  useEffect(() => {
    if (identity) return;
    const next = new URLSearchParams(location.search);
    next.set(
      "item",
      target.targetKind === "controller"
        ? `controller:${target.id}`
        : "add-controller",
    );
    navigate({ pathname: "/config", search: next.toString() });
    setIdentity(true);
  }, [
    identity,
    target.targetKind,
    target.id,
    location.search,
    navigate,
    setIdentity,
  ]);

  // Mobile bottom navigation targets (4 core destinations)
  const mobileRoutes = [
    { path: "/connect", name: "Connect" },
    { path: "/proxies", name: "Proxies" },
    { path: "/activity", name: "Activity" },
    { path: "/config", name: "Config" },
  ];

  const layout = (
    <div
      className={cn(
        "h-[100dvh] min-h-0 overflow-hidden p-3 pl-[212px]",
        "max-md:pt-[calc(var(--topbar-height)+env(safe-area-inset-top))] max-md:pr-0 max-md:pb-[calc(84px+env(safe-area-inset-bottom))] max-md:pl-0",
        !isClashX() &&
          "bg-[image:radial-gradient(ellipse_at_top_left,var(--surface-inset),transparent_65%)] bg-background",
      )}
    >
      <SideBar routes={mobileRoutes} />
      <div className="h-full w-full min-w-0 overflow-y-auto max-md:px-3 max-md:[&::-webkit-scrollbar]:hidden">
        <ControllerPage />
      </div>
      <Toaster />
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={layout}>
        <Route
          path="/"
          element={
            daemonState === "connecting" ? (
              <div role="status" className="p-6">
                XBond…
              </div>
            ) : (
              <Navigate
                to={{
                  pathname: initialPage,
                  search: location.search,
                }}
                replace
              />
            )
          }
        />

        {/* 8 Distinct Dedicated Routes */}
        <Route path="/connect" element={<Connect />} />
        <Route path="/proxies" element={<Proxies />} />
        <Route path="/config" element={<Config />} />
        <Route
          path="/subscriptions"
          element={
            <Navigate
              to={{ pathname: "/config", search: location.search }}
              replace
            />
          }
        />
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
