import { useAtom } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  Route,
  Navigate,
  Routes,
  useLocation,
  Outlet,
  useNavigate,
} from "react-router-dom";

import { CommandPalette } from "@/components/command-palette";
import {
  IS_MACOS,
  TitleBar,
  useMainWindowMaximized,
} from "@/components/title-bar";
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
import { syncSystemBars } from "@/platform/android-bridge";
import { installTauriDeepLinkListener } from "@/platform/deep-links";
import { useDesktopShell } from "@/platform/desktop-shell";
import { isMobileApp } from "@/platform/host";
import { isDesktopApp } from "@/platform/local-api-bootstrap";
import { identityAtom, useAPIInfo } from "@/state/controller-target";
import { useTheme } from "@/state/user-preferences";

import AppNavigation, {
  type Route as NavRoute,
} from "./navigation/app-navigation";
import { useStartupHandoff } from "./startup-handoff";

// Mobile bottom navigation targets (4 core destinations: 首页、代理、配置、设置)
const mobileRoutes: NavRoute[] = [
  { path: "/", name: "Connect" },
  { path: "/proxies", name: "Proxies" },
  { path: "/config", name: "Config" },
  { path: "/settings", name: "Settings" },
];

export default function App() {
  const theme = useTheme();
  // Desktop shell: deep-link drain, clipboard sniffing (reveal moved to the
  // startup hand-off below).
  useDesktopShell();
  // Startup hand-off: close the splash / release the native splash once the
  // daemon connection settles (or the cap fires).
  useStartupHandoff();

  const [identity, setIdentity] = useAtom(identityAtom);
  const target = useAPIInfo();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const navigate = useNavigate();
  const maximized = useMainWindowMaximized();
  const contentRef = useRef<HTMLElement>(null);

  // Instant scroll-to-top on route change to prevent jump flickering
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  // Android system back: close the topmost Radix overlay via a synthetic
  // Escape (dialogs close on it), else fall back from a sub-view to home;
  // an unhandled back backgrounds the app (moveTaskToBack on the native side).
  useEffect(() => {
    if (!isMobileApp()) return;
    window.__xbondHandleBack = () => {
      const overlay = document.querySelector(
        '[role="dialog"][data-state="open"]',
      );
      if (overlay) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return true;
      }
      // Top-level 4-Tab paths: hitting back on secondary tabs navigates to Home (/);
      // for any deeper pages (sub-routes or query params), pop the history stack.
      const isTopLevelTab = ["/", "/proxies", "/config", "/settings"].includes(
        location.pathname,
      );
      if (isTopLevelTab) {
        if (location.pathname !== "/") {
          navigate("/", { replace: true });
          return true;
        }
        return false;
      }
      if (window.history.length > 1) {
        window.history.back();
        return true;
      }
      navigate("/", { replace: true });
      return true;
    };
    return () => {
      delete window.__xbondHandleBack;
    };
  }, [location.pathname, navigate]);

  // Keep the Android status/gesture bars on the resolved theme surface so a
  // dark app never wears a white strip (the theme-color meta already holds
  // the hex applyTheme picked).
  useEffect(() => {
    if (!isMobileApp()) return;
    const isDark = document.documentElement.classList.contains("dark");
    const colorHex =
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") ?? undefined;
    syncSystemBars(isDark, colorHex ?? undefined);
  }, [theme]);

  // Pages ask for controller management by clearing the identity flag; send
  // them to the matching detail instead of reviving the removed modal.
  useEffect(() => {
    if (identity) return;
    const next = new URLSearchParams(location.search);
    next.set(
      "item",
      target.targetKind === "controller"
        ? `controller:${target.controller.id}`
        : "add-controller",
    );
    navigate({ pathname: "/config", search: next.toString() });
    setIdentity(true);
  }, [identity, target, location.search, navigate, setIdentity]);

  const navigateFromDeepLink = useEffectEvent((to: string) => navigate(to));
  useEffect(() => {
    if (!isMobileApp()) return;
    return installTauriDeepLinkListener(navigateFromDeepLink);
  }, []);

  const layout = (
    <div className="flex h-[100dvh] min-h-0 gap-2 overflow-hidden bg-transparent p-2 xl:gap-3 xl:p-3 max-md:gap-0 max-md:p-0">
      {/* Frameless Windows/Linux windows get no compositor shadow (tao drops
          it with decorations), so the webview edge disappears on light
          desktops. A hairline inset frame marks the boundary; maximized
          fills the screen, leaving no edge to mark. macOS keeps its native
          chrome (titleBarStyle Overlay). */}
      {isDesktopApp() && !IS_MACOS && !maximized && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 shadow-window-frame"
        />
      )}
      <AppNavigation routes={mobileRoutes} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        <main
          ref={contentRef}
          className={cn(
            "min-h-0 flex-1 overflow-x-clip overflow-y-auto rounded-hero max-md:rounded-none",
            (isHome || location.pathname === "/config") &&
              "-me-4 xl:-me-6 max-md:me-0",
            // No global mobile top bar anymore: the safe-area inset alone
            // clears the status bar, each tab paints its own context header.
            "max-md:px-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[calc(68px+env(safe-area-inset-bottom))] max-md:[&::-webkit-scrollbar]:hidden",
          )}
        >
          <ControllerPage />
        </main>
      </div>
      <Toaster
        position={isHome ? "top-right" : "bottom-right"}
        offset={
          isHome ? { top: "calc(var(--titlebar-height) + 16px)" } : undefined
        }
        mobileOffset={
          isHome
            ? {
                top: "calc(env(safe-area-inset-top) + 8px)",
              }
            : undefined
        }
      />
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
