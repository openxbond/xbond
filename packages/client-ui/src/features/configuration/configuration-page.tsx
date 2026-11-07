import { isAccountManaged } from "@xbond/client/localapi";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  Inbox,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AuroraWave } from "@/components/aurora-wave";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKind } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import { useAPIInfo, useExternals } from "@/state/controller-target";
import { useLocalAPI } from "@/state/local-runtime";

import AccountPanel from "./account/cloud-account-panel";
import { useAccount } from "./account/use-cloud-account";
import { ResourceIcon } from "./configuration-resource-icon";
import ControllerDetail from "./controllers/controller-details";
import ImportConfig from "./subscriptions/import-profile-form";
import SubscriptionDetail from "./subscriptions/subscription-details";
import { useSubscriptions } from "./subscriptions/use-subscriptions";

export default function Config() {
  const { t } = useTranslation("configuration");
  const { t: accountT } = useTranslation("account");
  const { t: common } = useTranslation("common");
  const { t: runtimeT } = useTranslation("runtime");
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
  const [savedControllers] = useExternals();
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
    } catch (error) {
      // 快速啟用失敗不可靜默：未捕獲的 Promise 會讓按鈕毫無回應。
      toast.error(runtimeT(errorKind(error)), { duration: 6000 });
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
    } catch (error) {
      toast.error(runtimeT(errorKind(error)), { duration: 6000 });
    } finally {
      setActivating(null);
    }
  }

  // 外部控制器列表：存儲內容即列表；當前瞬態目標（啟動參數／橋接）補入展示。
  const controllers = [...savedControllers];
  if (
    target.targetKind === "controller" &&
    !controllers.some((item) => item.id === target.controller.id)
  )
    controllers.push(target.controller);
  const defaultItem = supported
    ? activeId
      ? isAccountManaged(subscriptions.find((item) => item.id === activeId))
        ? "cloud"
        : `sub:${activeId}`
      : "cloud"
    : controllers[0]
      ? `controller:${controllers[0].id}`
      : "add-controller";
  const requested = explicit || defaultItem;
  // `sub:` 指向 Cloud 訂閱時回落 cloud 詳情；`controller:` 指向不存在的條目
  // （含舊的內建 id）時回落默認項。
  const selected =
    (requested.startsWith("sub:") &&
      subscriptions.some(
        (item) => item.id === requested.slice(4) && isAccountManaged(item),
      )) ||
    (requested.startsWith("controller:") &&
      !controllers.some((item) => item.id === requested.slice(11)))
      ? defaultItem
      : requested;
  const selectedController = selected.startsWith("controller:")
    ? controllers.find((item) => item.id === selected.slice(11))
    : undefined;
  const selectedSub = selected.startsWith("sub:")
    ? subscriptions.find((item) => item.id === selected.slice(4))
    : undefined;
  const filteredSubs = subscriptions.filter(
    (item) =>
      !isAccountManaged(item) &&
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
          <span
            className="inline-flex shrink-0 items-center text-brand"
            title={t("viewing")}
            aria-label={t("viewing")}
          >
            <Check className="size-4" strokeWidth={2.2} />
          </span>
        )}
        {!options?.isActive && options?.canActivate && options?.onActivate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-xs transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
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
    : target.targetKind === "controller"
      ? target.controller.name || target.hostname
      : t("noActive");
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const plainSubs = subscriptions.filter((item) => !isAccountManaged(item));

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      if (
        pickerRef.current?.open &&
        event.target instanceof Node &&
        !pickerRef.current.contains(event.target)
      ) {
        pickerRef.current.open = false;
      }
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);

  function pick(id: string) {
    pickerRef.current?.removeAttribute("open");
    choose(id);
  }
  function pickerEntry(
    id: string,
    title: string,
    kind: Parameters<typeof ResourceIcon>[0]["kind"],
  ) {
    const isActive = selected === id;
    return (
      <button
        type="button"
        key={id}
        className={cn("config-menu-item", isActive && "is-active")}
        onClick={() => pick(id)}
      >
        <ResourceIcon kind={kind} className="size-7 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {isActive && <Check className="size-3.5 shrink-0 text-brand" />}
      </button>
    );
  }

  return (
    <div className="page config-page relative">
      <AuroraWave className="-top-8 end-0 h-60 w-[58%] opacity-40" />
      {offline && (
        <Alert role="status" className="relative z-10">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("serviceUnavailable")}</span>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {common("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {/* 頁面頂欄：標題與副標題在左，「當前使用」環境膠囊在右（對齊設計稿） */}
      <header className="config-header relative z-20">
        <div className="config-list-intro">
          <h1>{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <details ref={pickerRef} className="group relative hidden md:block">
          <summary className="glass-button flex h-10 cursor-pointer list-none select-none items-center gap-2 rounded-full ps-2 pe-3.5 shadow-elevation-card xl:h-12 transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <ResourceIcon kind={activeIconKind} className="size-6.5" />
            <span className="text-xs text-muted-foreground">
              {t("viewing")} ·
            </span>
            <span className="max-w-44 truncate text-xs font-semibold text-foreground">
              {activeDisplayName}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="absolute end-0 top-[calc(100%+8px)] z-50 w-64 rounded-card border border-[var(--glass-border)] bg-popover p-2 shadow-[var(--elevation-raised)]">
            {supported && pickerEntry("cloud", "XBond Cloud", "cloud")}
            {plainSubs.length > 0 && (
              <>
                <p className="config-menu-heading">{t("profiles")}</p>
                {plainSubs.map((sub) =>
                  pickerEntry(`sub:${sub.id}`, sub.name, sub.format || "local"),
                )}
              </>
            )}
            {controllers.length > 0 && (
              <>
                <p className="config-menu-heading">{t("controllers")}</p>
                {controllers.map((controller) =>
                  pickerEntry(
                    `controller:${controller.id}`,
                    controller.name || new URL(controller.url).host,
                    "controller",
                  ),
                )}
              </>
            )}
          </div>
        </details>
      </header>

      {/* 雙欄工作區：左欄配置清單玻璃卡與右欄詳情容器頂部齊平 */}
      <div
        className={cn(
          "config-shell relative z-10 min-h-0",
          explicit && "has-selection",
        )}
      >
        <aside className="bento config-list" aria-label={t("title")}>
          <InputGroup className="mb-1">
            <InputGroupInput
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
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
                  <div className="flex flex-col gap-2 px-3 py-2" role="status">
                    <span className="sr-only">{common("loading")}</span>
                    <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-1/3 motion-reduce:animate-none" />
                  </div>
                ) : subsError ? (
                  <div className="config-list-empty" role="alert">
                    <p>{t("serviceUnavailable")}</p>
                    <Button variant="ghost" onClick={() => void refreshSubs()}>
                      {common("retry")}
                    </Button>
                  </div>
                ) : (
                  <p className="config-list-empty">
                    <Inbox
                      aria-hidden="true"
                      className="size-4 shrink-0 opacity-75"
                    />
                    <span>{search ? common("empty") : t("profileEmpty")}</span>
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
                    target.controller.id === controller.id
                    ? t("viewing")
                    : new URL(controller.url).host,
                  "controller",
                ),
              )
            ) : (
              <p className="config-list-empty">
                <Box
                  aria-hidden="true"
                  className="size-4 shrink-0 opacity-75"
                />
                <span>{search ? common("empty") : t("controllerEmpty")}</span>
              </p>
            ),
            { label: t("addController"), item: "add-controller" },
          )}
        </aside>
        <div className="config-main">
          <div className="config-detail" key={selected}>
            <div className="config-back">
              <Button variant="ghost" onClick={() => choose()}>
                <ArrowLeft className="size-4" />
                {t("back")}
              </Button>
            </div>
            <fieldset
              className="bento config-detail-flow min-w-0"
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
    </div>
  );
}
