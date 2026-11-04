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
  RefreshCw,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { QuotaRing } from "@/components/quota-ring";
import { Stat } from "@/components/stat";
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
import { useLocalAPI } from "@/state/local-runtime";
import { useLanguage } from "@/state/user-preferences";

import { ResourceIcon } from "../configuration-resource-icon";
import {
  useSubscriptionFetchProgress,
  useSubscriptions,
} from "../subscriptions/use-subscriptions";
import { useAccount } from "./use-cloud-account";

export default function AccountPanel() {
  const { t } = useTranslation("account");
  const { t: c } = useTranslation("configuration");
  const { t: conn } = useTranslation("connect");
  const { t: common } = useTranslation("common");
  const { lang } = useLanguage();
  const { hasDaemon, daemonState, refresh, isLocalTarget } = useLocalAPI();
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
  const authorizing = account?.status === "pending";
  const phase = account?.phase || (authorizing ? "authorizing" : undefined);
  const busy = pending || Boolean(phase) || Boolean(operation);
  const device = account?.method === "device";
  const current =
    isLocalTarget && cloudProfile?.id === activeId && Boolean(cloudProfile);

  const isDownloading =
    Boolean(
      phase &&
      (phase === "fetching_subscription" || phase === "syncing_subscription"),
    ) || pendingAction === "sync";
  const fetchProgress = useSubscriptionFetchProgress(isDownloading);

  const phaseText = {
    authorizing: t("pending"),
    exchanging_token: t("phaseExchange"),
    fetching_subscription: t("phaseFetch"),
    syncing_subscription: t("phaseSync"),
    loading_account: t("phaseOverview"),
  };

  const step =
    phase === "authorizing" || phase === "exchanging_token"
      ? 0
      : phase === "loading_account"
        ? 2
        : 1;

  // 只有真實位元組樣本才顯示百分比；階段本身由步驟條與文案交代，
  // 不為填滿進度條發明數字（DESIGN.md：沒有真實進度不畫百分比）。
  const downloadPercent =
    fetchProgress.total > 0
      ? Math.min(
          100,
          Math.round((fetchProgress.bytes / fetchProgress.total) * 100),
        )
      : null;

  const quota = subscriptionQuota(cloudProfile ?? null);
  const failure =
    error || account?.updateError || cloudProfile?.lastErrorMessage;

  async function action(
    work: () => Promise<unknown>,
    success = "",
    kind: "use" | "sync" | "account" = "account",
  ) {
    if (pending || daemonState !== "ready") return;
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

  async function update() {
    const result = await resync();
    if (result.updateError) throw new Error(result.updateError);
  }

  return (
    <div className="flex flex-col w-full gap-6" aria-busy={busy}>
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 @min-[34rem]/config-detail:flex-row @min-[34rem]/config-detail:items-center @min-[34rem]/config-detail:justify-between">
        <div className="flex items-start gap-4">
          <ResourceIcon kind="cloud" className="size-12 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
              XBond Cloud
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                {cloudProfile?.format || "XBond"}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {signedIn
                  ? account.name || account.email || t("signedIn")
                  : t("cloudDesc")}
              </span>
              {signedIn && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success-text">
                  <span className="size-1.5 rounded-full bg-success animate-pulse" />
                  {t("serviceHealthy")}
                </span>
              )}
              {current && (
                <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">
                  <Check className="size-3" />
                  {c("activeLocal")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top-Right Action Buttons (Consistent with SubscriptionDetail & ControllerDetail) */}
        <div className="flex shrink-0 items-center gap-2.5">
          {signedIn && (
            <Button
              variant="outline"
              disabled={busy}
              className="gap-2"
              onClick={() => void action(update, c("updated"), "sync")}
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  pendingAction === "sync" && "animate-spin",
                )}
              />
              {pendingAction === "sync"
                ? t("phaseSync")
                : failure
                  ? common("retry")
                  : t("syncSubscription")}
            </Button>
          )}

          {current ? (
            <Button
              variant="secondary"
              disabled
              className="pointer-events-none gap-1.5"
            >
              <Check className="size-4 text-success" />
              {c("activeLocal")}
            </Button>
          ) : signedIn ? (
            <Button
              variant="brand"
              disabled={busy}
              className="gap-1.5"
              onClick={() => void action(activateCloud, "", "use")}
            >
              {pendingAction === "use" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              {pendingAction === "use" ? t("applyingConfig") : c("use")}
            </Button>
          ) : (
            <Button
              variant="brand"
              disabled={busy}
              onClick={() => void action(() => login())}
            >
              {t("loginCta")}
            </Button>
          )}
        </div>
      </div>

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
        /* Enhanced Onboarding & Login Progress Stepper */
        <section
          className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-xs gap-6"
          aria-label={t("loginProgress")}
        >
          {/* Connected Stepper */}
          <div className="relative">
            <div className="absolute left-8 right-8 top-4 -z-0 h-0.5 bg-inset -translate-y-1/2">
              <div
                className="h-full bg-brand transition-all duration-500 ease-out"
                style={{
                  width: step === 0 ? "0%" : step === 1 ? "50%" : "100%",
                }}
              />
            </div>
            <ol className="relative z-10 flex justify-between">
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
                          "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-all shadow-xs",
                          isPast
                            ? "bg-brand text-brand-foreground"
                            : isCurrent
                              ? "bg-brand text-brand-foreground ring-4 ring-brand/20"
                              : "border border-border bg-inset text-muted-foreground",
                        )}
                      >
                        {isPast ? (
                          <Check className="size-4" strokeWidth={2.5} />
                        ) : isCurrent ? (
                          <LoaderCircle className="size-4 animate-spin" />
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
              <span className="flex items-center gap-2 font-medium text-foreground">
                <LoaderCircle className="size-4 animate-spin text-brand" />
                {phase ? phaseText[phase] : common("loading")}
              </span>
              {downloadPercent !== null && (
                <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
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
            <div className="flex flex-col gap-4 pt-2">
              {account?.userCode && (
                <div className="grid gap-2">
                  <span className="text-sm text-muted-foreground">
                    {t("deviceCode")}
                  </span>
                  <code className="w-fit rounded-control bg-inset px-4 py-3 text-xl font-semibold tracking-wider">
                    {account.userCode}
                  </code>
                </div>
              )}
              {(account?.authUrl ||
                account?.verificationUriComplete ||
                account?.verificationUri) && (
                <a
                  className="section-link inline-flex w-fit items-center gap-1.5 font-medium"
                  href={
                    account.authUrl ||
                    account.verificationUriComplete ||
                    account.verificationUri
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("openAuthPage")}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void action(cancelLogin)}
                >
                  {common("cancel")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    void action(async () => {
                      await cancelLogin();
                      await login({ device: !device });
                    })
                  }
                >
                  {device ? t("browserLogin") : t("deviceLogin")}
                </Button>
              </div>
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
                    {error ? t("actionFailed") : t("subscriptionUpdateFailed")}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {cloudProfile?.format
                      ? c("updateFailed")
                      : t("subscriptionNotReady")}
                  </p>
                </div>
              </div>
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

          {/* Quota & Plan Overview Card */}
          <div className="rounded-card border bg-card p-5 shadow-elevation-card">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {conn("quota.title")}
              </h3>
              {account.consoleUrl && (
                <a
                  className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  href={account.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden="true" className="size-3" />
                  {t("openConsole")}
                </a>
              )}
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-5 @min-[34rem]/config-detail:grid-cols-[auto_minmax(10rem,1fr)_auto] @min-[34rem]/config-detail:items-center">
              {quota ? (
                <>
                  <QuotaRing percent={quota.remainingPercent} />
                  <div className="flex min-w-0 flex-col gap-2">
                    <Stat label={t("quotaRemaining")} className="tabular-nums">
                      {formatTraffic(quota.remaining)}
                    </Stat>
                    <Stat
                      size="sm"
                      label={`${t("quotaUsed")} / ${t("quotaTotal")}`}
                      className="tabular-nums"
                    >
                      {formatTraffic(quota.used)} /{" "}
                      {formatTraffic(cloudProfile?.total ?? 0)}
                    </Stat>
                  </div>
                </>
              ) : (
                <div className="col-span-2 text-xs text-muted-foreground">
                  {c("unknownService")}
                </div>
              )}

              <div className="col-span-full flex min-w-0 flex-col gap-2.5 border-t border-border pt-4 text-xs @min-[34rem]/config-detail:col-span-1 @min-[34rem]/config-detail:border-t-0 @min-[34rem]/config-detail:border-s @min-[34rem]/config-detail:pt-0 @min-[34rem]/config-detail:ps-6">
                <div className="flex items-center justify-between gap-3 @min-[34rem]/config-detail:justify-start">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="size-3.5" />
                    {t("serviceExpiry")}
                  </span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {account.service?.servicePeriodEnd
                      ? new Date(
                          account.service.servicePeriodEnd,
                        ).toLocaleDateString(lang.replace("_", "-"))
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 @min-[34rem]/config-detail:justify-start">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Zap className="size-3.5" />
                    {t("servicePlan")}
                  </span>
                  <span className="font-medium text-foreground">
                    {account.service?.enabled
                      ? account.service.plan
                      : t("noService")}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 @min-[34rem]/config-detail:justify-start">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Globe className="size-3.5" />
                    {t("protocol")}
                  </span>
                  <span className="font-medium text-brand">
                    {cloudProfile?.format === "clash"
                      ? "Clash / mihomo"
                      : cloudProfile?.format === "sing-box"
                        ? "sing-box"
                        : "VLESS / Trojan"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Announcements Card */}
          {account.announcements && account.announcements.length > 0 && (
            <div className="flex flex-col rounded-card border bg-card p-5 shadow-elevation-card gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("announcements")}
              </h3>
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
            </div>
          )}

          {/* Danger Zone: Log Out */}
          <div className="rounded-card border border-destructive/25 bg-destructive/[0.03] p-5 shadow-elevation-card flex flex-col gap-4 @min-[34rem]/config-detail:flex-row @min-[34rem]/config-detail:items-center @min-[34rem]/config-detail:justify-between">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <LogOut className="size-4" />
                {t("logout")}
              </h3>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {c("logoutImpact")}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => setConfirmLogout(true)}
            >
              {t("logout")}
            </Button>
          </div>
        </>
      ) : (
        /* Signed-Out Landing Card */
        <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-xs gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-foreground">
              {t("loginCta")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("cloudDesc")}</p>
          </div>
          {account?.status === "error" && (
            <p className="config-error" role="alert">
              {account.errorCode === "session_expired"
                ? c("needsLogin")
                : t("failed")}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="brand"
              disabled={busy}
              onClick={() => void action(() => login())}
            >
              {t("loginCta")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void action(() => login({ device: true }))}
            >
              {t("deviceLogin")}
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
