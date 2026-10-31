import Activity from "@containers/Activity";
import Connect from "@containers/Connect";
import ExternalControllerModal from "@containers/ExternalControllerDrawer";
import Onboarding from "@containers/Onboarding";
import Proxies from "@containers/Proxies";
import Settings from "@containers/Settings";
import SideBar from "@containers/Sidebar";
import Subscriptions from "@containers/Subscriptions";
import { isClashX } from "@lib/jsBridge";
import { detectLocalAPIConfig, isDesktopApp } from "@lib/localapi-bootstrap";
import { NAV_REDIRECTS } from "@nav";
import {
  identityAtom,
  useAccount,
  useClient,
  useLocalAPI,
  useTheme,
} from "@stores";
import classnames from "classnames";
import { useSetAtom } from "jotai";
import { Route, Navigate, Routes, useLocation, Outlet } from "react-router-dom";

import "../styles/common.scss";
import "../styles/iconfont.scss";

/** Keeps the workspace query (controller selection) and adds the secondary
 * view parameter for a pre-NAV-01 top-level route. */
function LegacyRedirect({ to, view }: { to: string; view: string }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("view", view);
  return <Navigate replace to={{ pathname: to, search: params.toString() }} />;
}

export default function App() {
  const client = useClient();
  useTheme();

  const { hasLocalAPI, status } = useLocalAPI();
  const { account, accountReady } = useAccount();
  const setIdentity = useSetAtom(identityAtom);

  const location = useLocation();
  const initialPage =
    detectLocalAPIConfig() || isDesktopApp() ? "/connect" : "/proxies";

  // First-run gate: with the window's daemon reachable and no signed-in
  // account, a missing (or credential-revoked) configuration opens the
  // onboarding flow (sign in / import); resync re-binds the current
  // subscriptionLink. Remote-controller and web sessions are never gated.
  // `accountReady` keeps signed-in users from seeing a flash.
  const activeSub = status?.activeSub ?? null;
  const configUnusable =
    !activeSub || activeSub.health === "credential_invalid";
  const signedInNoSub =
    hasLocalAPI &&
    !!status &&
    configUnusable &&
    account?.status === "signed_in";
  const needsOnboarding =
    hasLocalAPI && !!status && configUnusable && accountReady && !signedInNoSub;

  if (needsOnboarding || signedInNoSub) {
    return (
      <>
        <Onboarding
          signedInNoSub={signedInNoSub}
          onConnectRemote={() => setIdentity(false)}
        />
        <ExternalControllerModal createOnly />
      </>
    );
  }

  const layout = (
    <div className={classnames("app", { "not-clashx": !isClashX() })}>
      <SideBar />
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

        {/* Five primary destinations (client-rethink §二): 连接 / 策略 /
            配置 / 活动 / 设置. Rules and diagnostics are secondary views of
            策略 and 活动 respectively. */}
        <Route path="/connect" element={<Connect />} />
        <Route path="/proxies" element={<Proxies />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />

        {/* Pre-NAV-01 top-level routes keep working as deep links. */}
        {Object.entries(NAV_REDIRECTS).map(([path, { to, view }]) => (
          <Route
            key={path}
            path={path}
            element={<LegacyRedirect to={to} view={view} />}
          />
        ))}

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
