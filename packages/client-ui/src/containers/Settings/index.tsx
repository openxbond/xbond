import { Button, ButtonSelect, Header, success, Switch } from "@components";
import { ControllerPicker } from "@components/ControllerPicker";
import AccountPanel from "@containers/AccountPanel";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import {
  proxyEndpoint,
  proxyTerminalCommand,
  type ProxyTerminalFormat,
} from "@lib/proxy-endpoint";
import { DASHBOARD_VERSION, parseClientInfo } from "@lib/version";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useConfig,
  useGeneral,
  useLanguage,
  useLocalAPI,
  useVersion,
  identityAtom,
  themeAtom,
  type ThemePreference,
} from "@stores";
import { validPort } from "@xbond/client/controller";
import { useAtom, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import "./style.scss";

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
  const { hasLocalAPI, isLocalTarget, status, setMode, refresh } =
    useLocalAPI();
  const { data: profile, set: setProfile } = useConfig();

  const [theme, setTheme] = useAtom(themeAtom);
  const setIdentity = useSetAtom(identityAtom);
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
      success(tc("copied"));
    });
  }

  return (
    <div className="page settings-page">
      <Header title={t("title")} />

      <div className="settings-grid">
        {/* Account: identity, service status and the trusted console entry.
            The sidebar avatar opens the same panel as a dialog; this card
            keeps the account reachable on mobile, which has no avatar.
            The account session is daemon-owned, so a pure remote target
            has no account data to show here. */}
        {hasLocalAPI && (
          <section className="settings-card">
            <div className="settings-card-header">
              <h2>{ta("title")}</h2>
            </div>
            <div className="settings-card-content">
              <AccountPanel />
            </div>
          </section>
        )}

        {/* Mobile-only entry: DESIGN.md promises subscriptions reachable
            from settings, since the phone crop hides the desktop rail. */}
        <section className="settings-card mobile-only">
          <Link to="/subscriptions" className="settings-entry-row">
            <div className="settings-entry-text">
              <strong>{t("subscriptionsEntry")}</strong>
              <span>{t("subscriptionsEntryDesc")}</span>
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
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </section>

        {/* Card 1: 網絡與連接埠。接管模式在桌面端由首頁環境帶獨家承載,
            這裡僅移動端保留(手機首頁裁掉了環境帶)。 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>
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

          <div className="settings-card-content">
            {hasLocalAPI && (
              <div className="setting-label-col mobile-only">
                <strong>{t("takeover.title")}</strong>
                <div className="takeover-options mt-2">
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
                        className="takeover-card-btn"
                        aria-pressed={status?.preferences.takeoverMode === mode}
                        disabled={pending || tunUnavailable}
                        title={
                          tunUnavailable
                            ? status?.capabilities?.tunReason
                            : undefined
                        }
                        onClick={() => void run(() => setMode({ mode }))}
                      >
                        <strong>{c(mode)}</strong>
                        <span>{t(`takeover.${mode}Desc` as const)}</span>
                      </button>
                    );
                  })}
                </div>
                {!status?.capabilities?.tun &&
                  status?.capabilities?.tunReasonCode && (
                    <p className="setting-note mt-2 text-warning">
                      {t(
                        `takeover.tunUnavailable.${status.capabilities.tunReasonCode}` as const,
                      )}
                    </p>
                  )}
                {status?.preferences.takeoverMode === "tun" &&
                  status?.capabilities?.tun && (
                    <p className="setting-note mt-2 text-warning">
                      {t("takeover.tunPrivilegeNotice")}
                    </p>
                  )}
              </div>
            )}

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("takeover.mixedPort")}</strong>
                <span>{t("takeover.mixedPortDesc")}</span>
              </div>
              <div className="setting-inline">
                <input
                  className="setting-port-input"
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
              <p className="setting-note text-muted-foreground">
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

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("takeover.allowLan")}</strong>
                <span>{t("takeover.allowLanDesc")}</span>
              </div>
              <Switch
                label={t("takeover.allowLan")}
                checked={status?.preferences.allowLan ?? general.allowLan}
                disabled={
                  pending ||
                  (isLocalTarget && !hasLocalAPI) ||
                  (!hasLocalAPI && !caps.editLan)
                }
                onChange={(allowLan) =>
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

            <div className="setting-row terminal-row">
              <div className="setting-label-col">
                <strong>{t("terminalCommand")}</strong>
                <span>{t("terminalCommandDesc")}</span>
              </div>
              <div className="setting-inline">
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
                  className="terminal-copy-btn"
                  onClick={copyTerminalCommand}
                >
                  {tc("copy")}
                </Button>
              </div>
            </div>
            <p className="setting-note font-mono text-muted-foreground terminal-preview">
              {terminalCommands[terminalFormat]}
            </p>
          </div>
        </section>

        {/* Card 2: 外觀與偏好 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>
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

          <div className="settings-card-content">
            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("theme")}</strong>
                <span>{t("themeDesc")}</span>
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

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("language")}</strong>
                <span>{t("languageDesc")}</span>
              </div>
              <select
                className="setting-select"
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

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("breakConnections")}</strong>
                <span>{t("breakConnectionsDesc")}</span>
              </div>
              <Switch
                label={t("breakConnections")}
                checked={profile.breakConnections}
                onChange={(value) => setProfile("breakConnections", value)}
              />
            </div>
          </div>
        </section>

        {/* Card 3: 控制器與端點 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>
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
              {tc("controller")}
            </h2>
            <Button onClick={() => setIdentity(false)}>{tc("edit")}</Button>
          </div>

          <div className="settings-card-content">
            <div className="setting-label-col">
              <strong>{t("controller.switchController")}</strong>
              <div className="mt-2">
                <ControllerPicker />
              </div>
            </div>

            <div className="controller-info-box">
              <div className="controller-info-row">
                <span>{t("controller.name")}</span>
                <strong>
                  {controller.name || (hasLocalAPI ? tc("local") : "—")}
                </strong>
              </div>
              <div className="controller-info-row">
                <span>{t("controller.address")}</span>
                <strong>{controller.url}</strong>
              </div>
              <div className="controller-info-row">
                <span>{t("controller.takeoverType")}</span>
                <strong>
                  {hasLocalAPI
                    ? t("controller.localDaemon")
                    : t("controller.externalCore")}
                </strong>
              </div>
            </div>
          </div>
        </section>

        {/* Card 4: 系統與核心 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>
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
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              {t("core.title")}
            </h2>
          </div>

          <div className="settings-card-content">
            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("about.coreVersion")}</strong>
              </div>
              <strong className="font-mono text-sm">
                {clientInfo.type} {clientInfo.version || "—"}
              </strong>
            </div>

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("core.localApi")}</strong>
              </div>
              <strong className="text-sm">
                {hasLocalAPI
                  ? status
                    ? t("core.localApiRunning")
                    : t("core.localApiDown")
                  : t("core.localApiNone")}
              </strong>
            </div>

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("about.logLevel")}</strong>
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
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>
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

          <div className="settings-card-content">
            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("about.appVersion")}</strong>
              </div>
              <strong className="font-mono text-sm">{DASHBOARD_VERSION}</strong>
            </div>
            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("about.openSource")}</strong>
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
