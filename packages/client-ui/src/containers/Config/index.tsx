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
import { ArrowLeft, Plus, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import ControllerDetail from "./ControllerDetail";
import ImportConfig from "./ImportConfig";
import { ResourceIcon } from "./ResourceIcon";
import SubscriptionDetail from "./SubscriptionDetail";

export default function Config() {
  const { t } = useTranslation("configuration");
  const { t: accountT } = useTranslation("account");
  const { t: common } = useTranslation("common");
  const [params, setParams] = useSearchParams();
  const explicit = params.get("item");
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
  } = useSubscriptions();
  const { account } = useAccount();
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
      ? `sub:${activeId}`
      : "cloud"
    : controllers[0]
      ? `controller:${controllers[0].id}`
      : "add-controller";
  const selected = explicit || defaultItem;
  const selectedController = selected.startsWith("controller:")
    ? controllers.find((item) => item.id === selected.slice(11))
    : undefined;
  const selectedSub = selected.startsWith("sub:")
    ? subscriptions.find((item) => item.id === selected.slice(4))
    : undefined;
  const filteredSubs = subscriptions.filter((item) =>
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
  ) {
    return (
      <button
        key={id}
        type="button"
        className={cn("config-resource", selected === id && "is-selected")}
        aria-current={selected === id ? "true" : undefined}
        onClick={() => choose(id)}
      >
        <ResourceIcon kind={kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </button>
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
  return (
    <div className="page config-page">
      <Header title={t("title")}>
        <span className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
          <ResourceIcon
            kind={isLocalTarget ? "local" : "controller"}
            className="size-8"
          />
          <span>
            {t("viewing")} ·{" "}
            {isLocalTarget ? t("localService") : target.name || target.hostname}
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
                    : account?.status === "signed_in"
                      ? account.name || account.email || accountT("signedIn")
                      : account?.status === "pending"
                        ? accountT("pending")
                        : accountT("loginCta"),
                "cloud",
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
                      `${sub.format || t("sourceLocal")} · ${sub.id === activeId ? t("activeLocal") : sub.type === "xbond" ? t("sourceCloud") : /^https?:/.test(sub.urlOrFile || "") ? t("sourceLink") : t("sourceLocal")}`,
                      sub.format || "local",
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
          {supported &&
            !isLocalTarget &&
            (selected === "cloud" ||
              selected.startsWith("sub:") ||
              selected === "add-profile") && (
              <p className="mb-6 border-b border-border pb-4 text-sm leading-relaxed text-muted-foreground">
                {t("scopeNote")}
              </p>
            )}
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
