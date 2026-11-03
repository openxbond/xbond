import { Button, ButtonSelect, Header, Switch } from "@components";
import { ControllerPicker } from "@components/ControllerPicker";
import AccountPanel from "@containers/AccountPanel";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import {
  proxyEndpoint,
  proxyTerminalCommand,
  type ProxyTerminalFormat,
} from "@lib/proxy-endpoint";
import { cn } from "@lib/utils";
import { DASHBOARD_VERSION, parseClientInfo } from "@lib/version";
import {
  DAEMON_CONTROLLER_ID,
  useAPIInfo,
  useCapabilities,
  useClient,
  useConfig,
  useGeneral,
  useLanguage,
  useLocalAPI,
  useSelectController,
  useVersion,
  externalControllerModalAtom,
  identityAtom,
  themeAtom,
  type ThemePreference,
} from "@stores";
import { validPort } from "@xbond/client/controller";
import { useAtom, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type TerminalFormat = ProxyTerminalFormat;

export default function Settings() {
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const { t: ta } = useTranslation("account");
  const { t: c } = useTranslation("connect");

  const controller = useAPIInfo();
  const caps = useCapabilities();
  const version = useVersion();
  const client = useClient();
  const { general, update } = useGeneral();
  const { hasLocalAPI, isLocalTarget, hasDaemon, status, setMode, refresh } =
    useLocalAPI();
  const { data: profile, set: setProfile } = useConfig();
  const select = useSelectController();

  const [theme, setTheme] = useAtom(themeAtom);
  const setIdentity = useSetAtom(identityAtom);
  const setModalState = useSetAtom(externalControllerModalAtom);
  const { run, pending } = useAction();

  const [port, setPort] = useState("");
  const [portValidation, setPortValidation] = useState("");
  const [terminalFormat, setTerminalFormat] =
    useState<TerminalFormat>("powershell");

  const currentPort =
    port || String(status?.preferences.mixedPort ?? general.mixedPort ?? "");
  const mixedPort = status?.preferences.mixedPort || general.mixedPort || 7890;
  const proxyAddress = proxyEndpoint(
    hasLocalAPI,
    controller.hostname,
    mixedPort,
  );
  const clientInfo = parseClientInfo(
    version.version,
    false,
    version.premium,
    version.meta,
  );

  const terminalCommands: Record<TerminalFormat, string> = {
    powershell: proxyTerminalCommand("powershell", proxyAddress),
    cmd: proxyTerminalCommand("cmd", proxyAddress),
    bash: proxyTerminalCommand("bash", proxyAddress),
  };

  async function savePort() {
    if (!validPort(Number(currentPort))) {
      setPortValidation(t("external.invalidPort"));
      return;
    }
    setPortValidation("");
    const parsed = Number(currentPort);
    await run(async () => {
      if (hasLocalAPI) {
        await setMode({ port: parsed });
        await refresh();
      } else {
        await client.updateConfig({ "mixed-port": parsed });
        await update();
      }
      setPort("");
    });
  }

  function copyTerminalCommand() {
    navigator.clipboard.writeText(terminalCommands[terminalFormat]).then(() => {
      toast.success(tc("copied"));
    });
  }

  return (
    <div className="page w-full gap-6">
      <Header title={t("title")} />

      <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3 items-start">
        {/* Account: identity, service status and the trusted console entry.
            The sidebar avatar opens the same panel as a dialog; this card
            keeps the account reachable on mobile and within settings. */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5">
            <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M17.5 19a4.5 4.5 0 0 0 .38-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 19.94h11.5Z" />
              </svg>
              {ta("title")}
            </h2>
          </div>
          <div className="flex flex-col gap-[18px]">
            <AccountPanel />
          </div>
        </section>

        {/* Mobile-only entry: DESIGN.md promises subscriptions reachable
            from settings, since the phone crop hides the desktop rail. */}
        <section className="hidden max-md:flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <Link
            to="/subscriptions"
            className="flex min-h-11 items-center justify-between gap-3 text-foreground no-underline"
          >
            <div className="flex flex-col gap-0.5">
              <strong className="text-body font-semibold">
                {t("subscriptionsEntry")}
              </strong>
              <span className="text-xs text-muted-foreground">
                {t("subscriptionsEntryDesc")}
              </span>
            </div>
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-muted-foreground"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </section>

        {/* Card 1: 網絡與連接埠。接管模式在桌面端由首頁環境帶獨家承載,
            這裡僅移動端保留(手機首頁裁掉了環境帶)。 */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5">
            <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              {t("network")}
            </h2>
          </div>

          <div className="flex flex-col gap-[18px]">
            {hasLocalAPI && (
              <div className="setting-label-col hidden max-md:flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("takeover.title")}
                </strong>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["sysproxy", "tun", "port"] as const).map((mode) => {
                    // TUN availability is a daemon-side fact (elevation,
                    // wintun driver), never a UI guess.
                    const tunUnavailable =
                      mode === "tun" &&
                      !!status?.capabilities &&
                      !status.capabilities.tun;
                    return (
                      <button
                        key={mode}
                        type="button"
                        className="flex flex-col items-start gap-1 rounded-sm border border-border bg-inset p-3 text-left text-foreground transition-all duration-150 hover:border-brand/40 hover:bg-row-hover aria-pressed:border-brand/40 aria-pressed:bg-brand-soft motion-reduce:transition-none"
                        aria-pressed={status?.preferences.takeoverMode === mode}
                        disabled={pending || tunUnavailable}
                        title={
                          tunUnavailable
                            ? status?.capabilities?.tunReason
                            : undefined
                        }
                        onClick={() => void run(() => setMode({ mode }))}
                      >
                        <strong className="text-body font-semibold">
                          {c(mode)}
                        </strong>
                        <span className="text-label leading-[1.3] text-muted-foreground">
                          {t(`takeover.${mode}Desc` as const)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!status?.capabilities?.tun &&
                  status?.capabilities?.tunReasonCode && (
                    <p className="mt-2 text-sm text-warning">
                      {t(
                        `takeover.tunUnavailable.${status.capabilities.tunReasonCode}` as const,
                      )}
                    </p>
                  )}
                {status?.preferences.takeoverMode === "tun" &&
                  status?.capabilities?.tun && (
                    <p className="mt-2 text-sm text-warning">
                      {t("takeover.tunPrivilegeNotice")}
                    </p>
                  )}
              </div>
            )}

            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("takeover.mixedPort")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("takeover.mixedPortDesc")}
                </span>
              </div>
              <div className="setting-inline flex items-center gap-2.5">
                <input
                  className="h-9 w-[90px] rounded-[6px] border border-border-strong bg-inset px-2.5 text-body text-foreground"
                  aria-label={t("takeover.mixedPort")}
                  type="number"
                  min="0"
                  max="65535"
                  value={currentPort}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={
                    pending ||
                    (isLocalTarget && !hasLocalAPI) ||
                    (!hasLocalAPI && !caps.editPorts)
                  }
                />
                <Button
                  disabled={
                    pending ||
                    !port ||
                    (isLocalTarget && !hasLocalAPI) ||
                    (!hasLocalAPI && !caps.editPorts)
                  }
                  onClick={() => void savePort()}
                >
                  {tc("confirm")}
                </Button>
              </div>
            </div>
            {portValidation && (
              <p role="alert" className="text-sm text-destructive">
                {portValidation}
              </p>
            )}
            {hasLocalAPI && (
              <p className="text-muted-foreground">
                {status?.preferences.portOverride
                  ? t("takeover.portNoteOverride", {
                      port: status.preferences.portOverride,
                    })
                  : status?.preferences.portSource === "subscription"
                    ? t("takeover.portNoteSubscription")
                    : t("takeover.portNoteDefault")}
              </p>
            )}
            {hasLocalAPI && !!status?.preferences.portOverride && (
              <div className="mt-1">
                <Button
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await setMode({ port: 0 });
                      await refresh();
                    })
                  }
                >
                  {t("takeover.portFollowSubscription")}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("takeover.allowLan")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("takeover.allowLanDesc")}
                </span>
              </div>
              <Switch
                aria-label={t("takeover.allowLan")}
                checked={status?.preferences.allowLan ?? general.allowLan}
                disabled={
                  pending ||
                  (isLocalTarget && !hasLocalAPI) ||
                  (!hasLocalAPI && !caps.editLan)
                }
                onCheckedChange={(allowLan) =>
                  void run(async () => {
                    if (hasLocalAPI) await setMode({ allowLan });
                    else {
                      await client.updateConfig({ "allow-lan": allowLan });
                      await update();
                    }
                  })
                }
              />
            </div>

            <div className="flex flex-col items-stretch gap-2.5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("terminalCommand")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("terminalCommandDesc")}
                </span>
              </div>
              <div className="setting-inline flex flex-wrap items-center gap-2.5">
                <ButtonSelect<TerminalFormat>
                  value={terminalFormat}
                  options={[
                    { value: "powershell", label: "PowerShell" },
                    { value: "cmd", label: "CMD" },
                    { value: "bash", label: "Bash / Zsh" },
                  ]}
                  onSelect={setTerminalFormat}
                />
                <Button
                  className="whitespace-nowrap"
                  onClick={copyTerminalCommand}
                >
                  {tc("copy")}
                </Button>
              </div>
            </div>
            <p className="-mt-2 font-mono text-muted-foreground [overflow-wrap:anywhere]">
              {terminalCommands[terminalFormat]}
            </p>
          </div>
        </section>

        {/* Card 2: 外觀與偏好 */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5">
            <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              {t("preferences")}
            </h2>
          </div>

          <div className="flex flex-col gap-[18px]">
            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("theme")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("themeDesc")}
                </span>
              </div>
              <ButtonSelect<ThemePreference>
                value={theme ?? "system"}
                options={[
                  { value: "system", label: t("system") },
                  { value: "light", label: t("light") },
                  { value: "dark", label: t("dark") },
                ]}
                onSelect={setTheme}
              />
            </div>

            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("language")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("languageDesc")}
                </span>
              </div>
              <select
                className="h-9 min-w-[132px] rounded-[6px] border border-border-strong bg-inset px-2.5 text-body text-foreground focus:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                aria-label={t("language")}
                value={lang}
                onChange={(event) => setLang(event.target.value as Lang)}
              >
                <option value="zh_HK">繁體中文</option>
                <option value="zh_CN">简体中文</option>
                <option value="en_US">English</option>
                <option value="ko">한국어</option>
                <option value="fa">فارسی</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("breakConnections")}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {t("breakConnectionsDesc")}
                </span>
              </div>
              <Switch
                aria-label={t("breakConnections")}
                checked={profile.breakConnections}
                onCheckedChange={(value) =>
                  setProfile("breakConnections", value)
                }
              />
            </div>
          </div>
        </section>

        {/* Card 3: 控制目标与核心 */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5">
            <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {t("targetAndCore")}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setModalState({ open: true, createOnly: true })}
              >
                {tc("addExternalController")}
              </Button>
              {!isLocalTarget && (
                <Button
                  className="h-8 text-xs"
                  onClick={() => setIdentity(false)}
                >
                  {tc("edit")}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-[18px]">
            <div className="setting-label-col flex flex-col gap-1">
              <strong className="text-body font-semibold text-foreground">
                {tc("controlTarget")}
              </strong>
              <div className="mt-2">
                <ControllerPicker />
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-sm border border-border bg-inset p-3.5 text-body">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("controller.takeoverType")}
                </span>
                <strong className="font-mono text-label">
                  {isLocalTarget
                    ? t("controller.localDaemon")
                    : t("controller.externalCore")}
                </strong>
              </div>

              {isLocalTarget ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("about.coreVersion")}
                    </span>
                    <strong className="font-mono text-label">
                      {clientInfo.type} {clientInfo.version || "—"}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("core.localApi")}
                    </span>
                    <div className="flex items-center gap-1.5 font-mono text-label">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          status?.engine.running
                            ? "bg-success"
                            : "bg-muted-foreground",
                        )}
                      />
                      <strong>
                        {hasDaemon
                          ? status?.engine.running
                            ? tc("running")
                            : tc("stopped")
                          : t("core.localApiNone")}
                      </strong>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("controller.address")}
                    </span>
                    <strong className="font-mono text-label">
                      {controller.url}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("about.coreVersion")}
                    </span>
                    <strong className="font-mono text-label">
                      {clientInfo.type} {clientInfo.version || "—"}
                    </strong>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {t("targetNotice")}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="h-8 text-xs font-semibold"
                      onClick={() => select(DAEMON_CONTROLLER_ID)}
                    >
                      {tc("switchToLocal")}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("about.logLevel")}
                </strong>
              </div>
              <ButtonSelect<string>
                value={general.logLevel || "info"}
                options={[
                  { value: "debug", label: "Debug" },
                  { value: "info", label: "Info" },
                  { value: "warn", label: "Warn" },
                  { value: "error", label: "Error" },
                  { value: "silent", label: "Silent" },
                ]}
                onSelect={(level) =>
                  void run(async () => {
                    await client.updateConfig({ "log-level": level });
                    await update();
                  })
                }
              />
            </div>
          </div>
        </section>

        {/* Card 5: 關於 */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3.5">
            <h2 className="m-0 flex items-center gap-2.5 text-base font-semibold">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2 2 7l10 5 10-5-10-5z" />
                <path d="m2 17 10 5 10-5" />
                <path d="m2 12 10 5 10-5" />
              </svg>
              {t("about.title")}
            </h2>
          </div>

          <div className="flex flex-col gap-[18px]">
            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("about.appVersion")}
                </strong>
              </div>
              <strong className="font-mono text-sm">{DASHBOARD_VERSION}</strong>
            </div>
            <div className="flex items-center justify-between gap-5 text-body max-md:flex-wrap">
              <div className="setting-label-col flex flex-col gap-1">
                <strong className="text-body font-semibold text-foreground">
                  {t("about.openSource")}
                </strong>
              </div>
              <a
                href="https://github.com/openxbond/xbond"
                target="_blank"
                rel="noopener noreferrer"
                className="section-link"
              >
                GitHub Repository ↗
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
