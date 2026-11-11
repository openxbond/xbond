import { formatTraffic } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import {
  AlertCircle,
  Calendar,
  Check,
  ExternalLink,
  Globe,
  LoaderCircle,
  LogOut,
  Megaphone,
  RefreshCw,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AuroraWave } from "@/components/aurora-wave";
import { CopyButton } from "@/components/copy-button";
import { QuotaRing } from "@/components/quota-ring";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { isMobileApp } from "@/platform/host";
import { isDesktopApp } from "@/platform/local-api-bootstrap";
import { openExternalUrl } from "@/platform/open-external";
import { useDaemonConnection } from "@/state/daemon-connection";
import { useLocalAPI } from "@/state/local-runtime";
import { useLanguage } from "@/state/user-preferences";

import { ResourceIcon } from "../configuration-resource-icon";
import UpdateFrequency from "../subscriptions/update-frequency-field";
import {
  useSubscriptionFetchProgress,
  useSubscriptions,
} from "../subscriptions/use-subscriptions";
import { useAccount } from "./use-cloud-account";

export default function AccountPanel() {
  const { t } = useTranslation("account");
  const { t: c } = useTranslation("configuration");
  const { t: subT } = useTranslation("subscriptions");
  const { t: conn } = useTranslation("connect");
  const { t: common } = useTranslation("common");
  const { lang } = useLanguage();
  const { hasDaemon, daemonState, refresh, isLocalTarget } = useLocalAPI();
  const { client: localClient } = useDaemonConnection();
  const { activeId, operation, refresh: refreshSubs } = useSubscriptions();
  const {
    account,
    accountReady,
    accountError,
    mutateAccount,
    login,
    logout,
    cancelLogin,
    resync,
    cloudProfile,
    activateCloud,
  } = useAccount();

  const [pendingAction, setPendingAction] = useState<
    "use" | "sync" | "account" | null
  >(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const connecting = daemonState === "connecting";
  const signedIn = account?.status === "signed_in";
  const serviceHealthy =
    signedIn &&
    account.service?.enabled &&
    account.service.status === "active" &&
    account.service.quotaState !== "blocked" &&
    !account.overviewError;
  const authorizing = account?.status === "pending";
  const phase = account?.phase || (authorizing ? "authorizing" : undefined);
  const busy = pending || Boolean(phase) || Boolean(operation);
  const current =
    isLocalTarget && cloudProfile?.id === activeId && Boolean(cloudProfile);

  const isDownloading =
    Boolean(
      phase &&
      (phase === "fetching_subscription" || phase === "syncing_subscription"),
    ) || pendingAction === "sync";
  const fetchProgress = useSubscriptionFetchProgress(isDownloading);

  // 只有真實位元組樣本才顯示百分比；階段本身由步驟條與文案交代，
  // 不為填滿進度條發明數字（DESIGN.md：沒有真實進度不畫百分比）。
  const downloadPercent =
    fetchProgress.total > 0
      ? Math.min(
          100,
          Math.round((fetchProgress.bytes / fetchProgress.total) * 100),
        )
      : null;

  const phaseText: Record<string, string> = {
    authorizing: t("pending"),
    exchanging_token: t("phaseExchange"),
    fetching_subscription: t("phaseFetch"),
    syncing_subscription: t("phaseSync"),
    loading_account: t("phaseOverview"),
  };

  // 授權 → 訂閱同步 → 就緒：令牌兌換仍屬授權段，讀取帳號已是收尾段。
  const step =
    phase === "authorizing" || phase === "exchanging_token"
      ? 0
      : phase === "loading_account"
        ? 2
        : 1;

  const quota = subscriptionQuota(cloudProfile ?? null);
  const failure =
    error || account?.updateError || cloudProfile?.lastErrorMessage;
  const isSessionExpiredFailure =
    account?.errorCode === "session_expired" ||
    (typeof failure === "string" &&
      (failure.includes("invalid_grant") ||
        failure.includes("session not found") ||
        failure.includes("session_expired")));

  async function action(
    work: () => Promise<unknown>,
    success = "",
    kind: "use" | "sync" | "account" = "account",
  ) {
    // 点击必须总有回应：服务未就绪时明说，而不是静默吞掉（按钮看起来坏了）。
    if (daemonState !== "ready") {
      setError(connecting ? common("loading") : c("serviceUnavailable"));
      return;
    }
    if (pending) return;
    setPendingAction(kind);
    setError("");
    setNotice("");
    try {
      await work();
      await Promise.all([refresh(), refreshSubs()]);
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  // Desktop's webview has no target="_blank" handling: hand the URL to the
  // shell command (system browser) instead. Browser hosts keep the native
  // anchor behavior.
  function openExternal(
    event: { preventDefault(): void },
    url?: string | null,
  ) {
    if (!url || (!isDesktopApp() && !isMobileApp())) return;
    event.preventDefault();
    openExternalUrl(url).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }

  async function update() {
    const result = await resync();
    if (result.updateError) throw new Error(result.updateError);
  }

  async function changeUpdateFrequency(hours: number) {
    if (!localClient || !cloudProfile) return;
    await action(async () => {
      await localClient.setSubUpdateSchedule(cloudProfile.id, hours);
      await Promise.all([refresh(), refreshSubs()]);
    });
  }

  async function changeUpdateChannel(channel: "direct" | "self" | "proxy") {
    if (!localClient || !cloudProfile) return;
    await action(async () => {
      await localClient.setSubChannel(cloudProfile.id, channel);
      await Promise.all([refresh(), refreshSubs()]);
    });
  }

  return (
    <div className="flex w-full flex-col gap-3 xl:gap-5" aria-busy={busy}>
      {/* 服務信息頭：上方為配置身份與單行狀態徽章，下方為操作按鈕列（對齊設計稿） */}
      <section className="flex flex-col gap-2.5 xl:gap-3.5">
        <div className="flex items-start gap-3.5">
          <ResourceIcon
            kind="cloud"
            className="size-12 shrink-0 rounded-control xl:size-16"
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold xl:text-metric tracking-tight text-foreground">
              XBond Cloud
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                {cloudProfile?.format || "XBond"}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {signedIn
                  ? account.name || account.email || t("signedIn")
                  : authorizing || phase
                    ? phaseText[phase ?? "authorizing"]
                    : t("signedOut")}
              </span>
              {serviceHealthy && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-text">
                  <span className="size-1.5 rounded-full bg-success" />
                  {t("serviceHealthy")}
                </span>
              )}
              {current && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-text">
                  <Check className="size-3" strokeWidth={2.2} />
                  {c("activeLocal")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 操作按鈕列置於身份區塊下方，保證四枚狀態標籤單行完整呈現 */}
        {(signedIn || current) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {signedIn && (
              <Button
                variant={isSessionExpiredFailure ? "brand" : "outline"}
                disabled={busy}
                className="h-9 gap-2 rounded-control px-3.5 shadow-2xs"
                onClick={() =>
                  void action(
                    isSessionExpiredFailure ? () => login() : update,
                    c("updated"),
                    isSessionExpiredFailure ? "account" : "sync",
                  )
                }
              >
                {isSessionExpiredFailure ? (
                  <Zap className="size-3.5" />
                ) : (
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      pendingAction === "sync" && "animate-spin",
                    )}
                  />
                )}
                {pendingAction === "sync"
                  ? t("phaseSync")
                  : isSessionExpiredFailure
                    ? t("loginCta")
                    : failure
                      ? common("retry")
                      : t("syncSubscription")}
              </Button>
            )}

            {!current && signedIn && (
              <Button
                variant="brand"
                disabled={busy}
                className="h-9 gap-1.5 rounded-control px-4 shadow-xs cursor-pointer"
                onClick={() => void action(activateCloud, "", "use")}
              >
                {pendingAction === "use" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                {pendingAction === "use" ? t("applyingConfig") : c("use")}
              </Button>
            )}

            {signedIn && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                className="ms-auto h-9 gap-1.5 rounded-control px-3 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmLogout(true)}
              >
                <LogOut className="size-3.5" />
                {t("logout")}
              </Button>
            )}
          </div>
        )}
      </section>

      {connecting ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-4 motion-safe:animate-spin"
          />
          {common("loading")}
        </p>
      ) : !hasDaemon ? (
        <p className="config-notice" role="status">
          {c("serviceUnavailable")}
        </p>
      ) : accountError ? (
        <div className="config-notice" role="alert">
          <p>{t("failed")}</p>
          <Button variant="outline" onClick={() => void mutateAccount()}>
            {common("retry")}
          </Button>
        </div>
      ) : !accountReady ? (
        <p role="status" className="text-sm text-muted-foreground">
          {common("loading")}
        </p>
      ) : authorizing || phase ? (
        /* Onboarding & Login Progress Stepper — inline on the panel, the
           flow's position and live bytes stay in one reading order with
           the account context (DESIGN.md: one task per surface). */
        <section
          className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-xs gap-6"
          aria-label={t("loginProgress")}
        >
          {/* Connected Stepper */}
          <div className="relative">
            <div className="absolute top-4 right-8 left-8 h-0.5 -translate-y-1/2 bg-inset">
              <div
                className="h-full w-full origin-left bg-brand transition-transform duration-500 ease-out motion-reduce:transition-none"
                style={{
                  transform: `scaleX(${step === 0 ? 0 : step === 1 ? 0.5 : 1})`,
                }}
              />
            </div>
            <ol className="relative flex justify-between">
              {[t("stepAuthorize"), t("stepSubscription"), t("stepReady")].map(
                (label, index) => {
                  const isPast = index < step;
                  const isCurrent = index === step;
                  return (
                    <li
                      key={label}
                      className="flex flex-col items-center gap-2 text-center"
                    >
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full text-xs font-semibold shadow-xs transition-[background-color,box-shadow,color] duration-200",
                          isPast
                            ? "bg-brand-action text-brand-action-foreground"
                            : isCurrent
                              ? "bg-brand-action text-brand-action-foreground ring-4 ring-brand/20"
                              : "border border-border bg-inset text-muted-foreground",
                        )}
                      >
                        {isPast ? (
                          <Check className="size-4" strokeWidth={2.5} />
                        ) : isCurrent ? (
                          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-xs transition-colors",
                          isCurrent
                            ? "font-semibold text-foreground"
                            : isPast
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                    </li>
                  );
                },
              )}
            </ol>
          </div>

          {/* Progress Bar & Real-time Bytes Status */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-inset/60 p-4">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-brand motion-reduce:animate-none" />
                <span className="truncate">
                  {phase ? phaseText[phase] : common("loading")}
                </span>
              </span>
              {downloadPercent !== null && (
                <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                  {downloadPercent}%
                </span>
              )}
            </div>

            {downloadPercent !== null && (
              <Progress value={downloadPercent} className="h-2.5 bg-inset" />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
              <span>{step === 0 ? t("authorizationHint") : t("syncHint")}</span>
              {fetchProgress.active && (
                <span className="font-mono font-medium text-foreground">
                  {fetchProgress.total > 0
                    ? `${formatTraffic(fetchProgress.bytes)} / ${formatTraffic(fetchProgress.total)}`
                    : formatTraffic(fetchProgress.bytes)}
                </span>
              )}
            </div>
          </div>

          {phase === "authorizing" && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {account?.authUrl && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void openExternalUrl(account.authUrl!).catch((err) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  {t("openAuthPage")}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => void action(cancelLogin)}
              >
                {common("cancel")}
              </Button>
            </div>
          )}
        </section>
      ) : signedIn ? (
        /* Signed-In Cloud Dashboard */
        <>
          {/* In-Flight Download & Sync Progress Bar */}
          {pendingAction === "sync" && (
            <div className="flex flex-col rounded-xl border border-brand/30 bg-brand-soft/40 p-4 gap-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <RefreshCw className="size-4 animate-spin text-brand" />
                  {t("syncingProgressTitle")}
                </span>
                <span className="font-mono text-xs font-semibold text-brand">
                  {downloadPercent !== null
                    ? `${downloadPercent}%`
                    : fetchProgress.bytes > 0
                      ? formatTraffic(fetchProgress.bytes)
                      : ""}
                </span>
              </div>
              {downloadPercent !== null && (
                <Progress value={downloadPercent} className="h-2" />
              )}
              <p className="text-xs text-muted-foreground">
                {fetchProgress.total > 0
                  ? t("downloadedTotal", {
                      received: formatTraffic(fetchProgress.bytes),
                      total: formatTraffic(fetchProgress.total),
                    })
                  : fetchProgress.bytes > 0
                    ? t("downloadedBytes", {
                        received: formatTraffic(fetchProgress.bytes),
                      })
                    : t("syncingProgressDesc")}
              </p>
            </div>
          )}

          {!cloudProfile?.format && !failure && !pending && (
            <p
              role="status"
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {t("subscriptionNotReady")}
            </p>
          )}

          {failure && !pending && (
            <div
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-4"
              role="alert"
            >
              <div className="flex items-start gap-3">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-destructive">
                    {isSessionExpiredFailure
                      ? c("needsLogin")
                      : error
                        ? t("actionFailed")
                        : t("subscriptionUpdateFailed")}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {isSessionExpiredFailure
                      ? t("loginFlowHint")
                      : cloudProfile?.format
                        ? c("updateFailed")
                        : t("subscriptionNotReady")}
                  </p>
                </div>
              </div>
              {isSessionExpiredFailure && (
                <div className="mt-3 ps-7">
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={busy}
                    onClick={() => void action(() => login())}
                  >
                    {t("loginCta")}
                  </Button>
                </div>
              )}
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  {t("errorDetails")}
                </summary>
                <p className="break-words pt-1 leading-relaxed [overflow-wrap:anywhere]">
                  {failure}
                </p>
              </details>
            </div>
          )}

          {/* Quota & Plan Card：配額環是卡片的視覺主角；右側帶柔和極光波形裝飾；
              底部收進三欄信息欄（到期／套餐／協議）。 */}
          <div className="relative overflow-hidden rounded-card border border-border/70 bg-card p-3.5 shadow-elevation-card xl:p-5 2xl:p-6">
            <AuroraWave className="top-2 -end-5 h-48 w-[58%] opacity-25" />
            <div className="relative z-10 mb-2 flex flex-wrap items-center justify-between gap-2 xl:mb-4">
              <h3 className="text-body font-semibold tracking-tight text-foreground">
                {conn("quota.title")}
              </h3>
              {account.consoleUrl && (
                <a
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-border-strong bg-card/90 px-3 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  href={account.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => openExternal(event, account.consoleUrl)}
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  {t("openConsole")}
                </a>
              )}
            </div>

            {quota ? (
              <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-4 xl:gap-6 xl:py-1">
                <QuotaRing
                  percent={quota.remainingPercent}
                  className="size-22 xl:size-32 2xl:size-36"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-label text-muted-foreground">
                    {t("quotaRemaining")}
                  </span>
                  <strong className="text-metric leading-tight font-semibold tracking-tight tabular-nums text-foreground">
                    {formatTraffic(quota.remaining)}
                  </strong>
                  <span className="mt-1 text-label text-muted-foreground">
                    {t("quotaUsed")} / {t("quotaTotal")}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-foreground/85">
                    {formatTraffic(quota.used)} /{" "}
                    {formatTraffic(cloudProfile?.total ?? 0)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="relative z-10 text-xs text-muted-foreground">
                {c("unknownService")}
              </p>
            )}

            {/* 底部信息欄：豎線分隔的三項讀數（到期時間 / 套餐 / 協議類型）。 */}
            <dl className="relative z-10 mt-3 grid grid-cols-1 gap-x-3 gap-y-3 border-t border-border pt-3 text-sm sm:grid-cols-3 sm:divide-x sm:divide-border xl:mt-4 xl:gap-x-6 xl:pt-4">
              {(
                [
                  {
                    Icon: Calendar,
                    label: t("serviceExpiry"),
                    value: account.service?.servicePeriodEnd
                      ? new Date(
                          account.service.servicePeriodEnd,
                        ).toLocaleDateString(lang.replace("_", "-"))
                      : "—",
                    mono: true,
                  },
                  {
                    Icon: Zap,
                    label: t("servicePlan"),
                    value: account.service?.enabled
                      ? account.service.plan
                      : t("noService"),
                  },
                  {
                    Icon: Globe,
                    label: t("protocol"),
                    value:
                      cloudProfile?.format === "clash"
                        ? "Clash / mihomo"
                        : cloudProfile?.format === "sing-box"
                          ? "sing-box"
                          : "VLESS / Trojan",
                    brand: true,
                  },
                ] satisfies Array<{
                  Icon: typeof Calendar;
                  label: string;
                  value: string;
                  mono?: boolean;
                  brand?: boolean;
                }>
              ).map(({ Icon, label, value, mono, brand }) => (
                <div
                  key={label}
                  className="flex min-w-0 flex-col gap-1 sm:ps-3 sm:first:ps-0 xl:ps-6"
                >
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    {label}
                  </dt>
                  <dd
                    className={cn(
                      "truncate text-body font-semibold tabular-nums",
                      mono && "font-mono",
                      brand ? "text-brand-text" : "text-foreground",
                    )}
                    title={value}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Subscription Source & Auto-Update Card */}
          <div className="flex flex-col gap-3.5 rounded-card border border-border/70 bg-card p-3.5 shadow-elevation-card xl:p-5 2xl:p-6">
            <h3 className="text-body font-semibold tracking-tight text-foreground">
              {c("sourceLink")}
            </h3>

            {/* URL Display with Copy button */}
            <div className="flex items-center gap-2 rounded-control border border-border/80 bg-inset px-3 py-2">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 select-all truncate font-mono text-xs text-foreground">
                {cloudProfile?.urlOrFile ||
                  account.subscription?.urlOrFile ||
                  "—"}
              </span>
              {(cloudProfile?.urlOrFile || account.subscription?.urlOrFile) && (
                <div className="flex shrink-0 items-center">
                  <CopyButton
                    value={
                      cloudProfile?.urlOrFile ||
                      account.subscription?.urlOrFile ||
                      ""
                    }
                    label={conn("copyLink")}
                  />
                </div>
              )}
            </div>

            {/* Sync Frequency (Default: 24h / Every day) */}
            <div className="border-t border-border/60 pt-3">
              <UpdateFrequency
                inline
                value={
                  cloudProfile?.autoUpdate
                    ? cloudProfile.updateIntervalHours || 24
                    : cloudProfile?.updateIntervalHours === 0
                      ? 0
                      : 24
                }
                disabled={busy || !localClient || !cloudProfile}
                onChange={(hours) => void changeUpdateFrequency(hours)}
              />
            </div>

            {/* Update Channel Selector */}
            <div className="flex flex-col gap-2 border-t border-border/60 pt-3 text-xs xl:flex-row xl:items-center xl:justify-between">
              <span className="text-muted-foreground">
                {subT("channelTitle")}
              </span>
              <SegmentedControl<"direct" | "self" | "proxy">
                ariaLabel={subT("channelTitle")}
                value={cloudProfile?.updateChannel || "direct"}
                size="sm"
                disabled={busy || !localClient || !cloudProfile}
                options={[
                  { label: subT("channelDirect"), value: "direct" },
                  { label: subT("channelSelf"), value: "self" },
                  { label: subT("channelProxy"), value: "proxy" },
                ]}
                onChange={(channel) => void changeUpdateChannel(channel)}
              />
            </div>
          </div>

          {/* Announcements Card：空狀態也保留卡片，交代「沒有公告」這個事實。 */}
          <div className="flex flex-col gap-3 rounded-card border border-border/70 bg-card p-3.5 shadow-elevation-card xl:p-5 2xl:p-6">
            <h3 className="text-body font-semibold tracking-tight text-foreground">
              {t("announcements")}
            </h3>
            {account.announcements && account.announcements.length > 0 ? (
              <div className="divide-y divide-border/60">
                {account.announcements.slice(0, 3).map((item) => (
                  <article key={item.id} className="py-3 first:pt-1 last:pb-1">
                    <h4 className="text-sm font-medium leading-snug text-foreground">
                      {item.title}
                    </h4>
                    {item.summary && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3.5 py-1">
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-text"
                >
                  <Megaphone className="size-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-foreground">
                    {t("announcementsEmpty")}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("announcementsEmptyDesc")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Signed-Out Landing Card */
        <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-xs gap-5">
          <div className="flex items-start gap-4">
            <ResourceIcon kind="cloud" className="size-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                {t("cloudDesc")}
              </h3>
            </div>
          </div>
          {account?.status === "error" && (
            <p className="config-error" role="alert">
              {account.errorCode === "session_expired"
                ? c("needsLogin")
                : t("failed")}
            </p>
          )}
          <div className="flex flex-col gap-2.5 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              {t("loginFlowHint")}
            </p>
            <Button
              variant="brand"
              size="lg"
              className="shrink-0"
              disabled={busy}
              onClick={() => void action(() => login())}
            >
              {t("loginCta")}
            </Button>
          </div>
        </div>
      )}

      {!signedIn && error && (
        <p className="config-error" role="alert">
          {error}
        </p>
      )}
      {notice && !busy && (
        <p role="status" className="text-sm text-success-text">
          {notice}
        </p>
      )}

      {/* Logout Confirmation Dialog */}
      <Dialog
        open={confirmLogout}
        onOpenChange={(open) => {
          if (!pending) setConfirmLogout(open);
        }}
      >
        <DialogContent closeLabel={common("close")}>
          <DialogHeader>
            <DialogTitle>{c("logoutConfirm")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {c("logoutImpact")}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmLogout(false)}
            >
              {common("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void action(async () => {
                  await logout();
                  setConfirmLogout(false);
                })
              }
            >
              {t("logout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
