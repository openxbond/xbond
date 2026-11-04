import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import {
  Route,
  Navigate,
  Routes,
  useLocation,
  Outlet,
  useNavigate,
} from "react-router-dom";

import { CommandPalette } from "@/components/command-palette";
import { TitleBar } from "@/components/title-bar";
import { Toaster } from "@/components/ui/sonner";
import Activity from "@/features/activity/activity-page";
import Connections from "@/features/activity/connections/connections-page";
import Logs from "@/features/activity/logs/logs-page";
import Config from "@/features/configuration/configuration-page";
import Connect from "@/features/connect/connect-page";
import Diagnostics from "@/features/diagnostics/diagnostics-page";
import ProxyPage from "@/features/proxies/proxies-page";
import Rules from "@/features/rules/rules-page";
import Settings from "@/features/settings/settings-page";
import { cn } from "@/lib/utils";
import { isClashX } from "@/platform/clashx-bridge";
import { useDesktopShell } from "@/platform/desktop-shell";
import { isDesktopApp } from "@/platform/local-api-bootstrap";
import { identityAtom, useAPIInfo } from "@/state/controller-target";
import { useTheme } from "@/state/user-preferences";

import SideBar from "./navigation/app-navigation";

// Mobile bottom navigation targets (4 core destinations)
const mobileRoutes = [
  { path: "/", name: "Connect" },
  { path: "/proxies", name: "Proxies" },
  { path: "/activity", name: "Activity" },
  { path: "/config", name: "Config" },
];

export default function App() {
  useTheme();
  // Desktop shell: anti-flash reveal, deep-link drain, clipboard sniffing.
  useDesktopShell();

  const [identity, setIdentity] = useAtom(identityAtom);
  const target = useAPIInfo();
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  // Instant scroll-to-top on route change to prevent jump flickering
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

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

  const layout = (
    <div
      className={cn(
        "h-[100dvh] min-h-0 overflow-hidden p-3 pl-[228px]",
        // Desktop frameless window: content islands start below the 40px
        // titlebar band, keeping the 12px island margin as the gap.
        isDesktopApp() && "pt-[calc(var(--titlebar-height)+12px)]",
        "max-md:pt-[calc(var(--topbar-height)+env(safe-area-inset-top))] max-md:pr-0 max-md:pb-[calc(84px+env(safe-area-inset-bottom))] max-md:pl-0",
        !isClashX() &&
          "bg-[image:radial-gradient(ellipse_at_top_left,var(--surface-inset),transparent_65%)] bg-background",
      )}
    >
      <TitleBar />
      <SideBar routes={mobileRoutes} />
      <div
        ref={contentRef}
        className="h-full w-full min-w-0 overflow-y-auto max-md:px-3 max-md:[&::-webkit-scrollbar]:hidden"
      >
        <ControllerPage />
      </div>
      <Toaster />
      <CommandPalette />
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={layout}>
        {/* 8 Distinct Dedicated Routes */}
        <Route index element={<Connect />} />
        <Route
          path="/connect"
          element={
            <Navigate
              to={{
                pathname: "/",
                search: location.search,
              }}
              replace
            />
          }
        />
        <Route path="/proxies" element={<ProxyPage />} />
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
                pathname: "/",
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
                pathname: "/",
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
