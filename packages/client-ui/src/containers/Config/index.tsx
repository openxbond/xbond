import { Button, Header, Input } from "@components";
import AccountPanel from "@containers/AccountPanel";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import { cn } from "@lib/utils";
import {
  DAEMON_CONTROLLER_ID,
  useAccount,
  useAPIInfo,
  useControllers,
  useLocalAPI,
  useSubscriptions,
} from "@stores";
import { ArrowLeft, Check, Plus, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import ControllerDetail from "./ControllerDetail";
import ImportConfig from "./ImportConfig";
import { ResourceIcon } from "./ResourceIcon";
import SubscriptionDetail from "./SubscriptionDetail";

export default function Config() {
  const { t } = useTranslation("configuration");
  const { t: accountT } = useTranslation("account");
  const { t: common } = useTranslation("common");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const explicit = params.get("item");

  useEffect(() => {
    if (explicit === "mixin") {
      navigate("/rules?tab=mixin", { replace: true });
    }
  }, [explicit, navigate]);

  const [search, setSearch] = useState("");
  const target = useAPIInfo();
  const [savedControllers] = useControllers();
  const { refresh, isLocalTarget, daemonState } = useLocalAPI();
  const supported = hasDaemonConfig();
  const offline = supported && daemonState === "offline";
  const connecting = supported && daemonState === "connecting";
  const daemonBlocked = supported && daemonState !== "ready";
  const {
    subscriptions,
    activeId,
    isLoading,
    error: subsError,
    refresh: refreshSubs,
    selectSub,
  } = useSubscriptions();
  const { account, cloudProfile, activateCloud } = useAccount();
  const [activating, setActivating] = useState<string | null>(null);

  async function quickActivateSub(subId: string) {
    if (activating) return;
    setActivating(subId);
    try {
      await selectSub(subId);
      await refresh();
      await refreshSubs();
    } finally {
      setActivating(null);
    }
  }

  async function quickActivateCloud() {
    if (activating) return;
    setActivating("cloud");
    try {
      await activateCloud();
      await refresh();
      await refreshSubs();
    } finally {
      setActivating(null);
    }
  }

  const controllers = savedControllers
    .filter((item) => item.id !== DAEMON_CONTROLLER_ID || !supported)
    .map((item) =>
      target.targetKind === "controller" && item.id === target.id
        ? { ...target }
        : item,
    );
  if (
    target.targetKind === "controller" &&
    !controllers.some((item) => item.id === target.id)
  )
    controllers.push({ ...target });
  const defaultItem = supported
    ? activeId
      ? subscriptions.find((item) => item.id === activeId)?.type === "xbond"
        ? "cloud"
        : `sub:${activeId}`
      : "cloud"
    : controllers[0]
      ? `controller:${controllers[0].id}`
      : "add-controller";
  const requested = explicit || defaultItem;
  const selected =
    requested.startsWith("sub:") &&
    subscriptions.some(
      (item) => item.id === requested.slice(4) && item.type === "xbond",
    )
      ? "cloud"
      : requested;
  const selectedController = selected.startsWith("controller:")
    ? controllers.find((item) => item.id === selected.slice(11))
    : undefined;
  const selectedSub = selected.startsWith("sub:")
    ? subscriptions.find((item) => item.id === selected.slice(4))
    : undefined;
  const filteredSubs = subscriptions.filter(
    (item) =>
      item.type !== "xbond" &&
      item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const filteredControllers = controllers.filter((item) =>
    `${item.name} ${item.url}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  function choose(item?: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (item) next.set("item", item);
      else next.delete("item");
      return next;
    });
  }
  function resource(
    id: string,
    title: string,
    subtitle: string,
    kind: Parameters<typeof ResourceIcon>[0]["kind"],
    options?: {
      isActive?: boolean;
      canActivate?: boolean;
      onActivate?: () => void | Promise<void>;
    },
  ) {
    return (
      <div
        key={id}
        className={cn(
          "config-resource group",
          selected === id && "is-selected",
        )}
        aria-current={selected === id ? "true" : undefined}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 border-none bg-transparent p-0 text-start cursor-pointer outline-none"
          onClick={() => choose(id)}
        >
          <ResourceIcon kind={kind} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          </span>
        </button>
        {options?.isActive && (
          <span className="shrink-0 text-xs font-medium text-brand inline-flex items-center gap-1">
            <Check className="size-3.5" />
            <span className="hidden sm:inline">{t("viewing")}</span>
          </span>
        )}
        {!options?.isActive && options?.canActivate && options?.onActivate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-xs transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            disabled={activating !== null}
            onClick={(e) => {
              e.stopPropagation();
              void options.onActivate!();
            }}
          >
            {t("quickActivate")}
          </Button>
        )}
      </div>
    );
  }
  function group(
    title: string,
    contents: ReactNode,
    add?: { label: string; item: string },
  ) {
    return (
      <section className="config-group" aria-label={title}>
        <div className="config-group-heading">
          <h2>{title}</h2>
          {add && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={add.label}
              title={add.label}
              onClick={() => choose(add.item)}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>
        {contents}
      </section>
    );
  }
  const isCloudActive =
    isLocalTarget && Boolean(cloudProfile) && activeId === cloudProfile?.id;
  const activeSub = subscriptions.find((item) => item.id === activeId);
  const activeIconKind = isLocalTarget
    ? isCloudActive
      ? "cloud"
      : activeSub?.format || "local"
    : "controller";
  const activeDisplayName = isLocalTarget
    ? isCloudActive
      ? "XBond Cloud"
      : activeSub?.name || t("localService")
    : target.name || target.hostname;

  return (
    <div className="page config-page">
      <Header title={t("title")}>
        <span className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
          <ResourceIcon kind={activeIconKind} className="size-8" />
          <span>
            {t("viewing")} · {activeDisplayName}
          </span>
        </span>
      </Header>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {offline && (
        <div className="config-notice" role="status">
          <p>{t("serviceUnavailable")}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {common("retry")}
          </Button>
        </div>
      )}
      <div className={cn("config-workspace", explicit && "has-selection")}>
        <div className="config-resources">
          <label htmlFor="config-search" className="relative mb-4 block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground"
            />
            <Input
              id="config-search"
              className="ps-9"
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {supported &&
            group(
              t("cloud"),
              resource(
                "cloud",
                "XBond Cloud",
                connecting
                  ? common("loading")
                  : offline
                    ? t("serviceOffline")
                    : account?.phase
                      ? t("working")
                      : account?.status === "signed_in"
                        ? cloudProfile?.format
                          ? isLocalTarget && activeId === cloudProfile.id
                            ? t("activeLocal")
                            : t("ready")
                          : account.updateError ||
                              cloudProfile?.lastErrorMessage
                            ? t("syncFailed")
                            : t("notReady")
                        : account?.status === "pending"
                          ? accountT("pending")
                          : accountT("loginCta"),
                "cloud",
                {
                  isActive:
                    isLocalTarget &&
                    Boolean(cloudProfile) &&
                    activeId === cloudProfile?.id,
                  canActivate:
                    account?.status === "signed_in" &&
                    Boolean(cloudProfile?.format),
                  onActivate: quickActivateCloud,
                },
              ),
            )}
          {supported &&
            group(
              t("profiles"),
              <>
                {filteredSubs.length ? (
                  filteredSubs.map((sub) =>
                    resource(
                      `sub:${sub.id}`,
                      sub.name,
                      `${sub.format || t("sourceLocal")} · ${!sub.format ? (sub.lastErrorMessage ? t("syncFailed") : t("notReady")) : isLocalTarget && sub.id === activeId ? t("activeLocal") : t("ready")}`,
                      sub.format || "local",
                      {
                        isActive: isLocalTarget && sub.id === activeId,
                        canActivate: Boolean(sub.format),
                        onActivate: () => quickActivateSub(sub.id),
                      },
                    ),
                  )
                ) : connecting ? (
                  <p className="config-list-empty" role="status">
                    {common("loading")}
                  </p>
                ) : offline ? (
                  <p className="config-list-empty">{t("serviceOffline")}</p>
                ) : isLoading ? (
                  <p className="config-list-empty" role="status">
                    {common("loading")}
                  </p>
                ) : subsError ? (
                  <div className="config-list-empty" role="alert">
                    <p>{t("serviceUnavailable")}</p>
                    <Button variant="ghost" onClick={() => void refreshSubs()}>
                      {common("retry")}
                    </Button>
                  </div>
                ) : (
                  <p className="config-list-empty">
                    {search ? common("empty") : t("profileEmpty")}
                  </p>
                )}
              </>,
              daemonBlocked
                ? undefined
                : { label: t("addProfile"), item: "add-profile" },
            )}
          {group(
            t("controllers"),
            filteredControllers.length ? (
              filteredControllers.map((controller) =>
                resource(
                  `controller:${controller.id}`,
                  controller.name || new URL(controller.url).host,
                  target.targetKind === "controller" &&
                    target.id === controller.id
                    ? t("viewing")
                    : new URL(controller.url).host,
                  "controller",
                ),
              )
            ) : (
              <p className="config-list-empty">
                {search ? common("empty") : t("controllerEmpty")}
              </p>
            ),
            { label: t("addController"), item: "add-controller" },
          )}
        </div>
        <div className="config-detail" key={selected}>
          <Button
            variant="ghost"
            className="mb-5 md:hidden"
            onClick={() => choose()}
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
          <fieldset
            className="min-w-0"
            disabled={
              daemonBlocked &&
              (selected === "cloud" ||
                selected.startsWith("sub:") ||
                selected === "add-profile")
            }
          >
            {selected === "cloud" && supported ? (
              <AccountPanel />
            ) : selected === "add-profile" && supported ? (
              <ImportConfig onAdded={(id) => choose(`sub:${id}`)} />
            ) : selected === "add-controller" ? (
              <ControllerDetail
                onSaved={(id) => choose(`controller:${id}`)}
                onRemoved={() => choose()}
              />
            ) : selectedController ? (
              <ControllerDetail
                controller={selectedController}
                onSaved={(id) => choose(`controller:${id}`)}
                onRemoved={() => choose()}
              />
            ) : selectedSub ? (
              <SubscriptionDetail selectedId={selectedSub.id} />
            ) : (
              <div className="config-empty">
                <ResourceIcon kind="local" className="size-14" />
                <h2 className="text-title font-semibold">{t("welcome")}</h2>
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                  {supported ? t("welcomeNote") : t("controllerEmpty")}
                </p>
                <Button
                  variant="brand"
                  onClick={() =>
                    choose(supported ? "add-profile" : "add-controller")
                  }
                >
                  {supported ? t("addProfile") : t("addController")}
                </Button>
              </div>
            )}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
