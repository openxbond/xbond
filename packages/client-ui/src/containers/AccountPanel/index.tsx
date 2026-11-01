import { Button } from "@components";
import { useAction } from "@lib/actions";
import { useAccount, useLanguage, useLocalAPI } from "@stores";
import { useTranslation } from "react-i18next";

/**
 * The XBond Cloud account surface: identity, service status, announcements
 * and the trusted console entry. One implementation, two mounts — the
 * sidebar avatar dialog and the Settings account card (the mobile bottom
 * bar has no avatar, so Settings keeps account reachable there).
 */
export default function AccountPanel() {
  const { t: ta } = useTranslation("account");
  const { lang } = useLanguage();
  const { status } = useLocalAPI();
  const {
    account,
    login: loginAccount,
    logout: logoutAccount,
    cancelLogin,
  } = useAccount();
  const { run, pending } = useAction();

  if (account?.status === "signed_in") {
    return (
      <div className="setting-label-col">
        <p className="text-sm">
          {account.name || account.email
            ? [account.name, account.email].filter(Boolean).join(" · ")
            : ta("signedIn")}
        </p>
        {account.service ? (
          <p className="text-sm text-muted-foreground">
            {[
              account.service.plan,
              account.service.servicePeriodEnd
                ? ta("serviceExpires", {
                    date: new Date(
                      account.service.servicePeriodEnd,
                    ).toLocaleDateString(lang),
                  })
                : null,
              account.service.quotaState === "blocked"
                ? ta("serviceQuotaBlocked")
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{ta("noService")}</p>
        )}
        {account.overviewError && (
          <p className="text-sm text-warning">
            {ta("overviewFailed", { error: account.overviewError })}
          </p>
        )}
        {account.announcements && account.announcements.length > 0 && (
          <div className="setting-label-col mt-2">
            <strong className="text-sm">{ta("announcements")}</strong>
            {account.announcements.slice(0, 3).map((item) => (
              <div key={item.id} className="text-sm">
                <span
                  className={item.readAt ? "text-muted-foreground" : undefined}
                >
                  {item.title}
                </span>
                {item.summary && (
                  <p className="text-sm text-muted-foreground">
                    {item.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="setting-inline mt-2">
          {account.consoleUrl && (
            <a
              href={account.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="section-link"
            >
              {ta("openConsole")} ↗
            </a>
          )}
          <Button
            type="danger"
            disabled={pending}
            onClick={() => void run(logoutAccount)}
          >
            {ta("logout")}
          </Button>
        </div>
      </div>
    );
  }

  if (account?.status === "pending") {
    // PKCE is the default: the daemon already opened the system browser, and
    // the auth URL stays reachable here for when that did not happen (browser
    // blocked, remote daemon). The device flow needs no loopback callback at
    // all — it is the fallback for web management of a remote daemon, where
    // the redirect cannot reach the machine holding the session.
    const deviceFlow = account.method === "device";
    return (
      <div className="setting-label-col">
        <p className="text-sm text-muted-foreground">{ta("pending")}</p>
        {deviceFlow ? (
          <div className="setting-label-col mt-2">
            <p className="text-sm">
              <a
                href={
                  account.verificationUriComplete || account.verificationUri
                }
                target="_blank"
                rel="noopener noreferrer"
                className="section-link"
              >
                {account.verificationUri}
              </a>
            </p>
            <p className="text-sm">
              {ta("deviceCode")}: <strong>{account.userCode}</strong>
            </p>
          </div>
        ) : (
          account.authUrl && (
            <p className="text-sm mt-2">
              <a
                href={account.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="section-link"
              >
                {ta("openAuthPage")}
              </a>
            </p>
          )
        )}
        <div className="setting-inline mt-2">
          <Button
            type="brand"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await cancelLogin();
                await loginAccount({ device: true });
              }, false)
            }
          >
            {deviceFlow ? ta("browserLogin") : ta("deviceLogin")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="setting-label-col">
      {status?.activeSub?.type === "universal" && (
        <p className="text-sm text-muted-foreground">{ta("note")}</p>
      )}
      {account?.status === "error" && (
        <p className="text-sm text-warning">
          {ta("failed")}: {account.error}
        </p>
      )}
      <div className="mt-2">
        <Button type="brand" onClick={() => loginAccount().catch(() => {})}>
          {ta("loginCta")}
        </Button>
      </div>
    </div>
  );
}
