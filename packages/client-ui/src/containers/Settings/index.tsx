import { Button, ButtonSelect, Header, Switch } from "@components";
import { ControllerPicker } from "@components/ControllerPicker";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import { DASHBOARD_VERSION } from "@lib/version";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
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

import "./style.scss";

export default function Settings() {
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const { t: r } = useTranslation("runtime");
  const { t: c } = useTranslation("connect");

  const controller = useAPIInfo();
  const caps = useCapabilities();
  const version = useVersion();
  const client = useClient();
  const { general, update } = useGeneral();
  const { hasLocalAPI, isLocalTarget, status, setMode, refresh } =
    useLocalAPI();

  const [theme, setTheme] = useAtom(themeAtom);
  const setIdentity = useSetAtom(identityAtom);
  const { run, pending } = useAction();

  const [port, setPort] = useState("");
  const [portValidation, setPortValidation] = useState("");

  const currentPort =
    port || String(status?.preferences.mixedPort ?? general.mixedPort ?? "");

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

  return (
    <div className="page settings-page">
      <Header title={t("title")} />

      <div className="settings-grid">
        {/* Card 1: 網絡與連接埠 (Network & Ports) */}
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
            {hasLocalAPI ? (
              <div className="setting-label-col">
                <strong>{t("takeover.title")}</strong>
                <div className="takeover-options mt-2">
                  {(["sysproxy", "tun", "port"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="takeover-card-btn"
                      aria-pressed={status?.preferences.takeoverMode === mode}
                      disabled={pending}
                      onClick={() => void run(() => setMode({ mode }))}
                    >
                      <strong>{c(mode)}</strong>
                      <span>{t(`takeover.${mode}Desc` as const)}</span>
                    </button>
                  ))}
                </div>
                {status?.preferences.takeoverMode === "tun" && (
                  <p className="setting-note mt-2 text-warning">
                    {t("takeover.tunPrivilegeNotice")}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{r("readonly")}</p>
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

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("takeover.allowLan")}</strong>
                <span>{t("takeover.allowLanDesc")}</span>
              </div>
              <Switch
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
          </div>
        </section>

        {/* Card 2: 外觀與偏好 (Appearance & Preferences) */}
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
              <ButtonSelect<Lang>
                value={lang}
                options={[
                  { value: "zh_HK", label: "繁體中文" },
                  { value: "zh_CN", label: "简体中文" },
                  { value: "en_US", label: "English" },
                  { value: "ko", label: "한국어" },
                  { value: "fa", label: "فارسی" },
                ]}
                onSelect={setLang}
              />
            </div>
          </div>
        </section>

        {/* Card 3: 控制器與端點 (Controllers & Endpoints) */}
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

        {/* Card 4: 系統狀態與關於 (System & About) */}
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
              {t("about.title")}
            </h2>
          </div>

          <div className="settings-card-content">
            <ul className="system-fact-list">
              <li>
                <span>{t("about.dashboardVersion")}</span>
                <strong>v{DASHBOARD_VERSION}</strong>
              </li>
              <li>
                <span>{t("about.coreVersion")}</span>
                <strong>{version.version || "—"}</strong>
              </li>
              <li>
                <span>{t("about.logLevel")}</span>
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
              </li>
              <li>
                <span>{t("about.openSource")}</span>
                <a
                  href="https://github.com/openxbond/xbond"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="section-link"
                >
                  GitHub Repository ↗
                </a>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
