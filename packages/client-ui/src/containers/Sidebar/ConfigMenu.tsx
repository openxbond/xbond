import { CloudMark, ResourceIcon } from "@containers/Config/ResourceIcon";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import {
  DAEMON_CONTROLLER_ID,
  useAccount,
  useAPIInfo,
  useControllers,
  useLocalAPI,
  useSelectController,
  useSubscriptions,
} from "@stores";
import { workspaceLink } from "@xbond/client/workspace";
import { ChevronUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

export function ConfigMenu() {
  const { t } = useTranslation("configuration");
  const { t: a } = useTranslation("account");
  const { t: common } = useTranslation("common");
  const supported = hasDaemonConfig();
  const target = useAPIInfo();
  const { daemonState } = useLocalAPI();
  const offline = supported && daemonState === "offline";
  const connecting = supported && daemonState === "connecting";
  const { account } = useAccount();
  const { subscriptions, activeId } = useSubscriptions();
  const [controllers] = useControllers();
  const external = controllers
    .filter((item) => item.id !== DAEMON_CONTROLLER_ID || !supported)
    .map((item) =>
      target.targetKind === "controller" && item.id === target.id
        ? { ...target }
        : item,
    );
  if (
    target.targetKind === "controller" &&
    !external.some((item) => item.id === target.id)
  )
    external.push({ ...target });
  const select = useSelectController();
  const location = useLocation();
  const root = useRef<HTMLDetailsElement>(null);
  const local = target.targetKind === "daemon";
  const label = local ? t("localService") : target.name || target.hostname;
  const profile = subscriptions.find((item) => item.id === activeId);
  function close() {
    if (root.current) root.current.open = false;
  }
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const link = (item: string) =>
    workspaceLink(location.search, "/config", { item });
  return (
    <details
      ref={root}
      className="config-unified"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          root.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="config-unified-trigger">
        <ResourceIcon kind={local ? "local" : "controller"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold" title={label}>
            {label}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {local ? t("localScope") : t("controllers")}
          </span>
          {supported && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <CloudMark className="size-3.5 shrink-0" />
              <span className="truncate">
                {connecting
                  ? common("loading")
                  : offline
                    ? t("serviceOffline")
                    : account?.status === "signed_in"
                      ? t("signedInShort")
                      : a("loginCta")}
              </span>
            </span>
          )}
        </span>
        <ChevronUp
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </summary>
      <div className="config-unified-panel">
        <p className="config-menu-heading">{t("viewing")}</p>
        {supported && (
          <button
            className="config-menu-item"
            type="button"
            disabled={local}
            onClick={() => {
              select(DAEMON_CONTROLLER_ID);
              close();
            }}
          >
            <ResourceIcon kind="local" className="size-8" />
            <span>
              {t("localService")}
              <small>
                {connecting
                  ? common("loading")
                  : offline
                    ? t("serviceOffline")
                    : t("localScope")}
              </small>
            </span>
            {local && <span aria-hidden="true">✓</span>}
          </button>
        )}
        {external.map((item) => (
          <button
            key={item.id}
            className="config-menu-item"
            type="button"
            disabled={
              !local && target.id === item.id && target.url === item.url
            }
            onClick={() => {
              select(item.id);
              close();
            }}
          >
            <ResourceIcon kind="controller" className="size-8" />
            <span className="truncate">
              {item.name || new URL(item.url).host}
            </span>
            {!local && target.id === item.id && (
              <span aria-hidden="true">✓</span>
            )}
          </button>
        ))}
        <Link
          className="config-menu-link"
          to={link("add-controller")}
          onClick={close}
        >
          {t("addController")}
        </Link>
        {supported && (
          <>
            <div className="config-menu-divider" />
            <p className="config-menu-heading">{t("localProfile")}</p>
            <Link
              className="config-menu-item"
              to={link(profile ? `sub:${profile.id}` : "add-profile")}
              onClick={close}
            >
              <ResourceIcon
                kind={profile?.format || "local"}
                className="size-8"
              />
              <span className="truncate">
                {profile?.name ||
                  (connecting
                    ? common("loading")
                    : t(offline ? "serviceOffline" : "noActive"))}
              </span>
            </Link>
            <div className="config-menu-divider" />
            <Link
              className="config-menu-item"
              to={link("cloud")}
              onClick={close}
            >
              <ResourceIcon kind="cloud" className="size-8" />
              <span>
                XBond Cloud
                <small>
                  {connecting
                    ? common("loading")
                    : offline
                      ? t("serviceOffline")
                      : account?.status === "signed_in"
                        ? account.name || account.email || a("signedIn")
                        : a("loginCta")}
                </small>
              </span>
            </Link>
          </>
        )}
        <div className="config-menu-divider" />
        <Link
          className="config-menu-link"
          to={workspaceLink(location.search, "/config")}
          onClick={close}
        >
          {t("title")}
        </Link>
      </div>
    </details>
  );
}
