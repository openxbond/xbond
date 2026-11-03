import { ResourceIcon } from "@containers/Config/ResourceIcon";
import { useAction } from "@lib/actions";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import { cn } from "@lib/utils";
import {
  DAEMON_CONTROLLER_ID,
  useAccount,
  useAPIInfo,
  useControllers,
  useSelectController,
  useSubscriptions,
} from "@stores";
import { workspaceLink } from "@xbond/client/workspace";
import { Check, ChevronUp, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

export function ConfigMenu() {
  const { t } = useTranslation("configuration");
  const { t: a } = useTranslation("account");
  const supported = hasDaemonConfig();
  const target = useAPIInfo();
  const { account, cloudProfile, activateCloud } = useAccount();
  const { subscriptions, activeId, selectSub, operation } = useSubscriptions();
  const { run, pending } = useAction();
  const [controllers] = useControllers();

  const isDaemonController = (item?: { id?: string; url?: string } | null) =>
    Boolean(
      item &&
      (item.id === DAEMON_CONTROLLER_ID ||
        item.id === "default" ||
        (target.targetKind === "daemon" && item.id === target.id)),
    );

  const isCloudSub = (
    sub?: {
      id?: string;
      type?: string;
      kind?: string;
      accountIssuer?: string;
    } | null,
  ) =>
    Boolean(
      sub &&
      (sub.type === "xbond" ||
        sub.kind === "cloud" ||
        Boolean(sub.accountIssuer) ||
        (cloudProfile && sub.id === cloudProfile.id)),
    );

  const external = controllers
    .filter((item) => !isDaemonController(item))
    .map((item) =>
      target.targetKind === "controller" && item.id === target.id
        ? { ...target }
        : item,
    );
  if (
    target.targetKind === "controller" &&
    !isDaemonController(target) &&
    !external.some((item) => item.id === target.id)
  ) {
    external.push({ ...target });
  }

  const select = useSelectController();
  const location = useLocation();
  const root = useRef<HTMLDetailsElement>(null);

  const local = target.targetKind === "daemon";
  const isCloudActive =
    local && Boolean(cloudProfile) && activeId === cloudProfile?.id;
  const activeSub = subscriptions.find((item) => item.id === activeId);

  const activeName = local
    ? isCloudActive
      ? "XBond Cloud"
      : activeSub?.name || t("localService")
    : target.name || target.hostname;

  const activeSubtitle = local
    ? isCloudActive
      ? account?.status === "signed_in"
        ? account.name || account.email || t("cloud")
        : t("cloud")
      : activeSub?.format
        ? `${activeSub.format} · ${t("activeLocal")}`
        : t("activeLocal")
    : t("controllers");

  const triggerIconKind = local
    ? isCloudActive
      ? "cloud"
      : activeSub?.format || "local"
    : "controller";

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

  return (
    <details
      ref={root}
      className="config-unified group"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          root.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="config-unified-trigger">
        <ResourceIcon kind={triggerIconKind} className="size-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-semibold leading-tight text-foreground"
            title={activeName}
          >
            {activeName}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {activeSubtitle}
          </span>
        </span>
        <ChevronUp
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
        />
      </summary>

      <div className="config-unified-panel">
        {/* Section 1: Profiles Switcher */}
        <p className="config-menu-heading">{t("profiles")}</p>

        {/* XBond Cloud Option */}
        {supported && (
          <button
            className={cn("config-menu-item", isCloudActive && "is-active")}
            type="button"
            disabled={pending || Boolean(operation) || isCloudActive}
            onClick={() => {
              if (account?.status === "signed_in") {
                void run(async () => {
                  await activateCloud();
                  close();
                });
              } else {
                close();
              }
            }}
          >
            <ResourceIcon kind="cloud" className="size-7 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">XBond Cloud</span>
              <small>
                {account?.status === "signed_in"
                  ? account.name || account.email || t("ready")
                  : a("loginCta")}
              </small>
            </span>
            {isCloudActive && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                <Check className="size-3.5" />
                {t("activeLocal")}
              </span>
            )}
          </button>
        )}

        {/* Universal Profiles List */}
        {supported &&
          subscriptions
            .filter((item) => !isCloudSub(item))
            .map((item) => {
              const isSubActive = local && activeId === item.id;
              return (
                <button
                  key={item.id}
                  className={cn("config-menu-item", isSubActive && "is-active")}
                  type="button"
                  disabled={
                    pending || Boolean(operation) || !item.format || isSubActive
                  }
                  onClick={() =>
                    void run(async () => {
                      await selectSub(item.id);
                      close();
                    })
                  }
                >
                  <ResourceIcon
                    kind={item.format || "local"}
                    className="size-7 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">
                      {item.name}
                    </span>
                    <small>
                      {item.format || "Universal"}
                      {item.kind === "local"
                        ? ` · ${t("kindLocal")}`
                        : item.kind === "inline"
                          ? ` · ${t("kindInline")}`
                          : ""}
                    </small>
                  </span>
                  {isSubActive && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                      <Check className="size-3.5" />
                      {t("activeLocal")}
                    </span>
                  )}
                </button>
              );
            })}

        {/* Section 2: External Controllers / Target Switching */}
        {external.length > 0 && (
          <>
            <div className="config-menu-divider" />
            <p className="config-menu-heading">{t("controllers")}</p>

            {/* This Device */}
            {supported && (
              <button
                className={cn("config-menu-item", local && "is-active")}
                type="button"
                disabled={local || Boolean(operation)}
                onClick={() => {
                  select(DAEMON_CONTROLLER_ID);
                  close();
                }}
              >
                <ResourceIcon kind="local" className="size-7 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-foreground">
                    {t("localService")}
                  </span>
                  <small>{t("localScope")}</small>
                </span>
                {local && <Check className="size-3.5 shrink-0 text-brand" />}
              </button>
            )}

            {/* Remote Controllers */}
            {external.map((item) => {
              const isCtrlActive =
                !local && target.id === item.id && target.url === item.url;
              return (
                <button
                  key={item.id}
                  className={cn(
                    "config-menu-item",
                    isCtrlActive && "is-active",
                  )}
                  type="button"
                  disabled={Boolean(operation) || isCtrlActive}
                  onClick={() => {
                    select(item.id);
                    close();
                  }}
                >
                  <ResourceIcon kind="controller" className="size-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">
                      {item.name || new URL(item.url).host}
                    </span>
                    <small>{new URL(item.url).host}</small>
                  </span>
                  {isCtrlActive && (
                    <Check className="size-3.5 shrink-0 text-brand" />
                  )}
                </button>
              );
            })}
          </>
        )}

        {/* Footer Quick Links */}
        <div className="config-menu-divider" />
        <div className="flex items-center justify-between pt-0.5">
          <Link
            className="config-menu-link"
            to={workspaceLink(location.search, "/config")}
            onClick={close}
          >
            <SlidersHorizontal className="size-3.5" />
            {t("title")}
          </Link>
          <Link
            className="config-menu-link"
            to={workspaceLink(location.search, "/config", {
              item: "add-profile",
            })}
            onClick={close}
          >
            <Plus className="size-3.5" />
            {t("addProfile")}
          </Link>
        </div>
      </div>
    </details>
  );
}
