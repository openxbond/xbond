import { workspaceLink } from "@xbond/client/workspace";
import { Check, ChevronUp, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAccount } from "@/features/configuration/account/use-cloud-account";
import { ResourceIcon } from "@/features/configuration/configuration-resource-icon";
import { useSubscriptions } from "@/features/configuration/subscriptions/use-subscriptions";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import {
  useAPIInfo,
  useExternals,
  useSelectTarget,
} from "@/state/controller-target";
import { useLocalAPI } from "@/state/local-runtime";

export function ConfigMenu() {
  const { t } = useTranslation("configuration");
  const { t: a } = useTranslation("account");
  const { t: s } = useTranslation("subscriptions");
  const supported = hasDaemonConfig();
  const target = useAPIInfo();
  const { account, cloudProfile, activateCloud } = useAccount();
  const { subscriptions, activeId, selectSub, operation } = useSubscriptions();
  const { run, pending } = useAction();
  const [externals] = useExternals();

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

  // 外部控制器條目：存儲列表 + 當前瞬態目標（啟動參數／橋接，尚未保存）。
  const external = [...externals];
  if (
    target.targetKind === "controller" &&
    !external.some((item) => item.id === target.controller.id)
  ) {
    external.push(target.controller);
  }

  const universalSubs = subscriptions.filter((item) => !isCloudSub(item));

  const select = useSelectTarget();
  const location = useLocation();
  const navigate = useNavigate();
  const root = useRef<HTMLDetailsElement>(null);

  const local = target.targetKind === "daemon";
  const isCloudActive =
    local && Boolean(cloudProfile) && activeId === cloudProfile?.id;
  const activeSub = subscriptions.find((item) => item.id === activeId);
  const { hasDaemon } = useLocalAPI();

  const activeName = local
    ? isCloudActive
      ? "XBond Cloud"
      : activeSub?.name || t("localService")
    : target.targetKind === "controller"
      ? target.controller.name || target.hostname
      : t("noActive");

  const activeSubtitle = local
    ? isCloudActive
      ? t("activeLocal")
      : !hasDaemon
        ? t("localOffline")
        : activeSub?.format
          ? `${activeSub.format} · ${t("activeLocal")}`
          : t("activeLocal")
    : t("controllers");

  const activeTooltip =
    isCloudActive && (account?.name || account?.email)
      ? `${activeName} (${account.name || account.email})`
      : activeName;

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
      <summary className="config-unified-trigger" title={activeTooltip}>
        <ResourceIcon kind={triggerIconKind} className="size-7.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-foreground">
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
        {/* Target 1: XBond Cloud */}
        {supported && (
          <div className="config-menu-section">
            <p className="config-menu-heading">{t("cloud")}</p>
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
                  // 未登入不是死路：帶用戶到配置頁的 Cloud 詳情登入。
                  close();
                  navigate({ pathname: "/config", search: "?item=cloud" });
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
          </div>
        )}

        {/* Target 2: 订阅配置 */}
        {supported && universalSubs.length > 0 && (
          <div className="config-menu-section">
            <div className="config-menu-divider" />
            <p className="config-menu-heading">{t("profiles")}</p>
            {universalSubs.map((item) => {
              const isSubActive = local && activeId === item.id;
              return (
                <button
                  key={item.id}
                  className={cn("config-menu-item", isSubActive && "is-active")}
                  type="button"
                  disabled={
                    pending || Boolean(operation) || !item.format || isSubActive
                  }
                  title={!item.format ? t("notReady") : undefined}
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
                      {item.format || s("typeUniversal")}
                      {item.kind === "local"
                        ? ` · ${t("kindLocal")}`
                        : item.kind === "inline"
                          ? ` · ${t("kindInline")}`
                          : ""}
                      {item.lastErrorMessage ? ` · ${t("syncFailed")}` : ""}
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
          </div>
        )}

        {/* Target 3: 外部控制器 (ONLY external remote controllers; NEVER local daemon) */}
        {external.length > 0 && (
          <div className="config-menu-section">
            <div className="config-menu-divider" />
            <p className="config-menu-heading">{t("controllers")}</p>
            {external.map((item) => {
              const isCtrlActive =
                target.targetKind === "controller" &&
                target.controller.id === item.id;
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
                    select({ kind: "controller", id: item.id });
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
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                      <Check className="size-3.5" />
                      {t("activeLocal")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
