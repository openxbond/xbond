import { Button, ButtonSelect, Header, Switch } from "@components";
import { ControllerPicker } from "@components/ControllerPicker";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import { validPort } from "@lib/controller";
import { DASHBOARD_VERSION } from "@lib/version";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useGeneral,
  useI18n,
  useLocalAPI,
  useVersion,
  identityAtom,
  themeAtom,
  type ThemePreference,
} from "@stores";
import { useAtom, useSetAtom } from "jotai";
import { useState } from "react";

import "./style.scss";

export default function Settings() {
  const { translation, lang, setLang } = useI18n();
  const { t } = translation("Settings");
  const { t: ui } = translation("ClientUI");
  const { t: r } = translation("Runtime");

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
      setPortValidation(r("invalidPort"));
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
              {ui("network")}
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
                      <strong>{ui(mode)}</strong>
                      <span>
                        {t(
                          ("takeover." + mode + "Desc") as
                            | "takeover.sysproxyDesc"
                            | "takeover.tunDesc"
                            | "takeover.portDesc",
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{r("readonly")}</p>
            )}

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("takeover.mixedPort")}</strong>
                <span>標準 HTTP / SOCKS 混合本地代理連接埠</span>
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
                  {ui("confirm")}
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
                <span>允許同區域網絡的其他裝置連接本地代理</span>
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
              {ui("preferences")}
            </h2>
          </div>

          <div className="settings-card-content">
            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("labels.theme")}</strong>
                <span>自訂使用者介面的色彩明暗外觀</span>
              </div>
              <ButtonSelect<ThemePreference>
                value={theme ?? "system"}
                options={[
                  { value: "system", label: t("values.system") },
                  { value: "light", label: t("values.light") },
                  { value: "dark", label: t("values.dark") },
                ]}
                onSelect={setTheme}
              />
            </div>

            <div className="setting-row">
              <div className="setting-label-col">
                <strong>{t("labels.language")}</strong>
                <span>切換用戶端顯示的介面語言</span>
              </div>
              <ButtonSelect<Lang>
                value={lang}
                options={[
                  { value: "zh_HK", label: "繁體中文" },
                  { value: "zh_CN", label: "简体中文" },
                  { value: "en_US", label: "English" },
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
              {ui("controller")}
            </h2>
            <Button onClick={() => setIdentity(false)}>{r("edit")}</Button>
          </div>

          <div className="settings-card-content">
            <div className="setting-label-col">
              <strong>切換已連接的控制器</strong>
              <div className="mt-2">
                <ControllerPicker />
              </div>
            </div>

            <div className="controller-info-box">
              <div className="controller-info-row">
                <span>控制器名稱</span>
                <strong>
                  {controller.name || (hasLocalAPI ? ui("local") : "—")}
                </strong>
              </div>
              <div className="controller-info-row">
                <span>控制 API 位址</span>
                <strong>{controller.url}</strong>
              </div>
              <div className="controller-info-row">
                <span>接管服務型態</span>
                <strong>
                  {hasLocalAPI
                    ? "本機獨立服務 (Daemon)"
                    : "外部核心 (External)"}
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
              系統與關於
            </h2>
          </div>

          <div className="settings-card-content">
            <ul className="system-fact-list">
              <li>
                <span>用戶端儀表板版本</span>
                <strong>v{DASHBOARD_VERSION}</strong>
              </li>
              <li>
                <span>sing-box 核心版本</span>
                <strong>{version.version || "—"}</strong>
              </li>
              <li>
                <span>記錄日誌等級 (Log Level)</span>
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
                <span>開放原始碼專案</span>
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
