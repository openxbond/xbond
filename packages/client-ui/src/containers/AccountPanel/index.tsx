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
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function AccountPanel() {
  const { t } = useTranslation("account");
  const { t: c } = useTranslation("configuration");
  const { t: common } = useTranslation("common");
  const { lang } = useLanguage();
  const { hasDaemon, daemonState, refresh } = useLocalAPI();
  const { refresh: refreshSubs } = useSubscriptions();
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
  const signedIn = account?.status === "signed_in";
  const authorizing = account?.status === "pending";
  const device = account?.method === "device";
  return (
    <div className="config-detail-stack" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ResourceIcon kind="cloud" className="size-14" />
          <div className="min-w-0">
            <h2 className="text-title font-semibold">XBond Cloud</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {signedIn
                ? account.name || account.email || t("signedIn")
                : t("cloudDesc")}
            </p>
          </div>
        </div>
        {signedIn && <span className="config-status">{t("signedIn")}</span>}
      </div>
      {connecting ? (
        <p role="status" className="text-muted-foreground">
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
        <p role="status" className="text-muted-foreground">
          {common("loading")}
        </p>
      ) : authorizing ? (
        <div className="flex flex-col items-start gap-4">
          <h3 className="text-subtitle font-semibold">{t("pending")}</h3>
          {account.userCode && (
            <div className="grid gap-2">
              <span className="text-sm">{t("deviceCode")}</span>
              <code className="rounded-control bg-inset px-4 py-3 text-xl font-semibold">
                {account.userCode}
              </code>
            </div>
          )}
          {(account.authUrl ||
            account.verificationUriComplete ||
            account.verificationUri) && (
            <a
              className="section-link"
              href={
                account.authUrl ||
                account.verificationUriComplete ||
                account.verificationUri
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openAuthPage")} ↗
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
              variant="outline"
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
      ) : signedIn ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="brand"
              disabled={pending}
              onClick={() => void action(update, c("updated"))}
            >
              {pending ? common("loading") : t("syncSubscription")}
            </Button>
            {account.consoleUrl && (
              <a
                className="section-link text-sm"
                href={account.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("openConsole")} ↗
              </a>
            )}
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmLogout(true)}
            >
              {t("logout")}
            </Button>
          </div>
          {(error || account.updateError) && (
            <div className="config-notice" role="alert">
              <p className="font-medium">{c("updateFailed")}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {error || account.updateError}
              </p>
            </div>
          )}
          <section className="grid gap-3 border-t border-border pt-5">
            <h3 className="text-subtitle font-semibold">{t("title")}</h3>
            {account.service ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {[
                  account.service.enabled
                    ? account.service.plan
                    : t("noService"),
                  account.service.servicePeriodEnd
                    ? t("serviceExpires", {
                        date: new Date(
                          account.service.servicePeriodEnd,
                        ).toLocaleDateString(lang.replace("_", "-")),
                      })
                    : null,
                  account.service.quotaState === "blocked"
                    ? t("serviceQuotaBlocked")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
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
          {account.subscription && (
            <section className="grid gap-3 border-t border-border pt-5">
              <h3 className="text-subtitle font-semibold">
                {c("sourceCloud")}
              </h3>
              <div className="flex items-center gap-3">
                <ResourceIcon kind={account.subscription.format || "local"} />
                <div>
                  <p className="font-medium">{account.subscription.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {c("localScope")}
                  </p>
                </div>
              </div>
            </section>
          )}
          {account.announcements && account.announcements.length > 0 && (
            <section className="grid gap-3 border-t border-border pt-5">
              <h3 className="text-subtitle font-semibold">
                {t("announcements")}
              </h3>
              {account.announcements.slice(0, 3).map((item) => (
                <article key={item.id}>
                  <h4 className="text-sm font-medium">{item.title}</h4>
                  {item.summary && (
                    <p className="mt-1 text-sm text-muted-foreground">
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
          <Button
            variant="brand"
            disabled={pending}
            onClick={() => void action(() => login())}
          >
            {t("loginCta")}
          </Button>
        </div>
      )}
      {!signedIn && error && (
        <p className="config-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
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
