import { Button } from "@components";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/ui/dialog";
import { ResourceIcon } from "@containers/Config/ResourceIcon";
import {
  useAccount,
  useLanguage,
  useLocalAPI,
  useSubscriptions,
} from "@stores";
import {
  AlertCircle,
  Check,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function AccountPanel() {
  const { t } = useTranslation("account");
  const { t: c } = useTranslation("configuration");
  const { t: common } = useTranslation("common");
  const { lang } = useLanguage();
  const { hasDaemon, daemonState, refresh, isLocalTarget } = useLocalAPI();
  const {
    subscriptions,
    activeId,
    selectSub,
    refresh: refreshSubs,
  } = useSubscriptions();
  const {
    account,
    accountReady,
    accountError,
    mutateAccount,
    login,
    logout,
    cancelLogin,
    resync,
  } = useAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const connecting = daemonState === "connecting";
  const signedIn = account?.status === "signed_in";
  const authorizing = account?.status === "pending";
  const phase = account?.phase || (authorizing ? "authorizing" : undefined);
  const busy = pending || Boolean(phase);
  const device = account?.method === "device";
  const cloudProfile = subscriptions.find((item) => item.type === "xbond");
  const current =
    isLocalTarget && cloudProfile?.id === activeId && Boolean(cloudProfile);
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
  const failure = error || account?.updateError;

  async function action(work: () => Promise<unknown>, success = "") {
    if (pending || daemonState !== "ready") return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await work();
      await Promise.all([refresh(), refreshSubs()]);
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }
  async function update() {
    const result = await resync();
    if (result.updateError) throw new Error(result.updateError);
  }

  return (
    <div className="config-detail-stack" aria-busy={busy}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ResourceIcon kind="cloud" className="size-12" />
          <div className="min-w-0">
            <h2 className="text-title font-semibold">XBond Cloud</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {signedIn
                ? account.name || account.email || t("signedIn")
                : t("cloudDesc")}
            </p>
          </div>
        </div>
        {signedIn && (
          <span className="config-status">
            <Check aria-hidden="true" className="me-1.5 size-3.5" />
            {t("signedIn")}
          </span>
        )}
      </header>

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
        <section className="grid gap-5" aria-label={t("loginProgress")}>
          <ol className="grid grid-cols-3 gap-3 border-y border-border py-5">
            {[t("stepAuthorize"), t("stepSubscription"), t("stepReady")].map(
              (label, index) => (
                <li
                  key={label}
                  className="flex min-w-0 flex-col items-start gap-2 text-xs"
                  aria-current={index === step ? "step" : undefined}
                >
                  <span
                    className={
                      index <= step
                        ? "flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand-text"
                        : "flex size-7 items-center justify-center rounded-full bg-inset text-muted-foreground"
                    }
                  >
                    {index < step ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : index === step ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 motion-safe:animate-spin"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-current"
                      />
                    )}
                  </span>
                  <span
                    className={
                      index === step
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {label}
                  </span>
                </li>
              ),
            )}
          </ol>
          <div role="status" aria-live="polite" className="grid gap-2">
            <h3 className="text-subtitle font-semibold">
              {phase ? phaseText[phase] : common("loading")}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {step === 0 ? t("authorizationHint") : t("syncHint")}
            </p>
          </div>
          {phase === "authorizing" && (
            <>
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
                  className="section-link inline-flex w-fit items-center gap-1.5"
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
            </>
          )}
        </section>
      ) : signedIn ? (
        <>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || current || !cloudProfile?.format}
                variant={current ? "secondary" : "default"}
                onClick={() => {
                  if (cloudProfile)
                    void action(() => selectSub(cloudProfile.id));
                }}
              >
                {current && <Check aria-hidden="true" className="size-4" />}
                {current ? c("activeLocal") : c("use")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action(update, c("updated"))}
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 motion-safe:animate-spin"
                  />
                ) : (
                  <RefreshCw aria-hidden="true" className="size-4" />
                )}
                {pending
                  ? t("phaseSync")
                  : failure
                    ? common("retry")
                    : t("syncSubscription")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {account.consoleUrl && (
                <a
                  className="section-link inline-flex min-h-11 items-center gap-1.5 text-sm"
                  href={account.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("openConsole")}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmLogout(true)}
              >
                {t("logout")}
              </Button>
            </div>
          </div>
          {failure && !pending && (
            <div className="rounded-control bg-inset p-4" role="alert">
              <div className="flex items-start gap-3">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning-text"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t("subscriptionUpdateFailed")}
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
          <section className="grid gap-3 border-t border-border pt-5">
            <h3 className="text-subtitle font-semibold">{t("title")}</h3>
            {account.service ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t("servicePlan")}</dt>
                  <dd className="font-medium">
                    {account.service.enabled
                      ? account.service.plan
                      : t("noService")}
                  </dd>
                </div>
                {account.service.servicePeriodEnd && (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">
                      {t("serviceExpiry")}
                    </dt>
                    <dd>
                      {new Date(
                        account.service.servicePeriodEnd,
                      ).toLocaleDateString(lang.replace("_", "-"))}
                    </dd>
                  </div>
                )}
                {account.service.quotaState === "blocked" && (
                  <p className="text-warning-text">
                    {t("serviceQuotaBlocked")}
                  </p>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {c("unknownService")}
              </p>
            )}
            {account.overviewError && (
              <p className="text-sm text-warning-text">
                {t("overviewFailed", { error: account.overviewError })}
              </p>
            )}
          </section>
          {account.announcements && account.announcements.length > 0 && (
            <section className="grid gap-4 border-t border-border pt-5">
              <h3 className="text-subtitle font-semibold">
                {t("announcements")}
              </h3>
              {account.announcements.slice(0, 3).map((item) => (
                <article key={item.id}>
                  <h4 className="text-sm font-medium leading-relaxed">
                    {item.title}
                  </h4>
                  {item.summary && (
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {item.summary}
                    </p>
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      ) : (
        <div className="grid justify-items-start gap-4">
          {account?.status === "error" && (
            <p className="config-error" role="alert">
              {account.errorCode === "session_expired"
                ? c("needsLogin")
                : t("failed")}
            </p>
          )}
          <Button disabled={busy} onClick={() => void action(() => login())}>
            {t("loginCta")}
          </Button>
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
