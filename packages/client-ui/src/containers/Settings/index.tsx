import { Button, ButtonSelect, Header, Switch, XBondIcon } from "@components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import { isClashX } from "@lib/jsBridge";
import { isDesktopApp } from "@lib/localapi-bootstrap";
import {
  proxyEndpoint,
  proxyTerminalCommand,
  type ProxyTerminalFormat,
} from "@lib/proxy-endpoint";
import { cn } from "@lib/utils";
import { DASHBOARD_VERSION, parseClientInfo } from "@lib/version";
import {
  desktopPreferencesAtom,
  themeAtom,
  useAPIInfo,
  useCapabilities,
  useClient,
  useConfig,
  useGeneral,
  useLanguage,
  useLocalAPI,
  useVersion,
  type ThemePreference,
} from "@stores";
import { validPort } from "@xbond/client/controller";
import { useAtom } from "jotai";
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  ExternalLink,
  ListFilter,
  Network,
  Sliders,
  Terminal,
} from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type TerminalFormat = ProxyTerminalFormat;

interface SettingRowProps {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function SettingRow({
  title,
  description,
  badge,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "group -mx-3 flex flex-col gap-2 rounded-xl p-3 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between sm:gap-6 hover:bg-row-hover/50",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-body font-semibold text-foreground tracking-tight">
            {title}
          </strong>
          {badge}
        </div>
        {description && (
          <span className="text-xs text-muted-foreground leading-relaxed max-w-xl">
            {description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 self-start sm:self-center">
        {children}
      </div>
    </div>
  );
}

export default function Settings() {
  const { lang, setLang } = useLanguage();
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const { t: c } = useTranslation("connect");
  const navigate = useNavigate();

  const controller = useAPIInfo();
  const caps = useCapabilities();
  const client = useClient();
  const version = useVersion();
  const { general, update } = useGeneral();
  const { hasLocalAPI, isLocalTarget, status, setMode, refresh } =
    useLocalAPI();
  const { data: profile, set: setProfile } = useConfig();

  const [theme, setTheme] = useAtom(themeAtom);
  const [desktopPrefs, setDesktopPrefs] = useAtom(desktopPreferencesAtom);
  const { run, pending } = useAction();

  const [port, setPort] = useState("");
  const [portValidation, setPortValidation] = useState("");
  const [terminalFormat, setTerminalFormat] =
    useState<TerminalFormat>("powershell");
  const [copied, setCopied] = useState(false);

  const isDesktop = isDesktopApp();
  const clientInfo = parseClientInfo(
    version.version,
    isClashX(),
    version.premium,
    version.meta,
  );

  const currentPort =
    port || String(status?.preferences.mixedPort ?? general.mixedPort ?? "");
  const mixedPort = status?.preferences.mixedPort || general.mixedPort || 7890;
  const proxyAddress = proxyEndpoint(
    hasLocalAPI,
    controller.hostname,
    mixedPort,
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
      setCopied(true);
      toast.success(tc("copied"));
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="page mx-auto w-full max-w-4xl gap-6 pb-16">
      <Header title={t("title")} />

      <div className="flex w-full flex-col gap-6">
        {/* Section 1: 常規偏好 (Preferences & General) */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 ring-1 ring-brand/20">
                <Sliders className="size-4.5 text-brand" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <h2 className="m-0 text-base font-semibold text-foreground">
                  {t("preferences")}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t("generalDesc")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Theme */}
            <SettingRow title={t("theme")} description={t("themeDesc")}>
              <ButtonSelect<ThemePreference>
                value={theme ?? "system"}
                options={[
                  { value: "system", label: t("system") },
                  { value: "light", label: t("light") },
                  { value: "dark", label: t("dark") },
                ]}
                onSelect={setTheme}
              />
            </SettingRow>

            {/* Language */}
            <SettingRow title={t("language")} description={t("languageDesc")}>
              <Select
                value={lang}
                onValueChange={(val) => setLang(val as Lang)}
              >
                <SelectTrigger
                  className="h-9 min-w-[140px] rounded-control border-border-strong bg-inset text-body text-foreground transition-colors hover:border-brand/40 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  aria-label={t("language")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-border bg-popover shadow-elevation-raised">
                  <SelectItem value="zh_HK">繁體中文 (香港)</SelectItem>
                  <SelectItem value="zh_CN">简体中文</SelectItem>
                  <SelectItem value="en_US">English</SelectItem>
                  <SelectItem value="ko">한국어</SelectItem>
                  <SelectItem value="fa">فارسی</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            {/* Break Connections */}
            <SettingRow
              title={t("breakConnections")}
              description={t("breakConnectionsDesc")}
            >
              <Switch
                aria-label={t("breakConnections")}
                checked={profile.breakConnections}
                onCheckedChange={(val) => setProfile("breakConnections", val)}
              />
            </SettingRow>

            {/* Desktop Host Capabilities (when isDesktop) */}
            {isDesktop && (
              <>
                <SettingRow
                  title={t("desktop.autostart")}
                  description={t("desktop.autostartDesc")}
                  badge={
                    <span className="inline-flex items-center rounded-md border border-border bg-inset px-1.5 py-0.5 text-label font-medium text-muted-foreground uppercase tracking-wider">
                      Desktop
                    </span>
                  }
                >
                  <Switch
                    aria-label={t("desktop.autostart")}
                    checked={desktopPrefs.autostart}
                    onCheckedChange={(val) =>
                      setDesktopPrefs((prev) => ({ ...prev, autostart: val }))
                    }
                  />
                </SettingRow>

                <SettingRow
                  title={t("desktop.closeToTray")}
                  description={t("desktop.closeToTrayDesc")}
                  badge={
                    <span className="inline-flex items-center rounded-md border border-border bg-inset px-1.5 py-0.5 text-label font-medium text-muted-foreground uppercase tracking-wider">
                      Desktop
                    </span>
                  }
                >
                  <Switch
                    aria-label={t("desktop.closeToTray")}
                    checked={desktopPrefs.closeToTray}
                    onCheckedChange={(val) =>
                      setDesktopPrefs((prev) => ({ ...prev, closeToTray: val }))
                    }
                  />
                </SettingRow>
              </>
            )}
          </div>
        </section>

        {/* Section 2: 網絡與連接埠 (Network & Ports) */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 ring-1 ring-brand/20">
                <Network className="size-4.5 text-brand" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <h2 className="m-0 text-base font-semibold text-foreground">
                  {t("network")}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t("networkDesc")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Mobile Takeover (when hasLocalAPI) */}
            {hasLocalAPI && (
              <div className="hidden max-md:flex flex-col gap-2.5 pb-2">
                <strong className="text-body font-semibold text-foreground">
                  {t("takeover.title")}
                </strong>
                <div className="grid grid-cols-3 gap-2">
                  {(["sysproxy", "tun", "port"] as const).map((mode) => {
                    const tunUnavailable =
                      mode === "tun" &&
                      !!status?.capabilities &&
                      !status.capabilities.tun;
                    return (
                      <button
                        key={mode}
                        type="button"
                        className="flex flex-col items-start gap-1 rounded-control border border-border bg-inset p-3 text-left text-foreground transition-all duration-150 hover:border-brand/40 hover:bg-row-hover aria-pressed:border-brand/40 aria-pressed:bg-brand-soft motion-reduce:transition-none"
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
                    <p className="mt-1 text-sm text-warning-text">
                      {t(
                        `takeover.tunUnavailable.${status.capabilities.tunReasonCode}` as const,
                      )}
                    </p>
                  )}
                {status?.preferences.takeoverMode === "tun" &&
                  status?.capabilities?.tun && (
                    <p className="mt-1 text-sm text-warning-text">
                      {t("takeover.tunPrivilegeNotice")}
                    </p>
                  )}
              </div>
            )}

            {/* Mixed Port */}
            <div className="-mx-3 flex flex-col gap-2.5 rounded-xl p-3 transition-colors duration-150 hover:bg-row-hover/50">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-body font-semibold text-foreground tracking-tight">
                      {t("takeover.mixedPort")}
                    </strong>
                    {status?.preferences.portOverride ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft px-2 py-0.5 text-label font-medium text-brand-text">
                        <span className="size-1.5 rounded-full bg-brand" />
                        {t("takeover.portNoteOverride", {
                          port: status.preferences.portOverride,
                        })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-inset px-2 py-0.5 text-label font-medium text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                        {status?.preferences.portSource === "subscription"
                          ? t("takeover.portNoteSubscription")
                          : t("takeover.portNoteDefault")}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                    {t("takeover.mixedPortDesc")}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    className={cn(
                      "h-9 w-28 rounded-control border bg-inset px-3 font-mono text-sm text-foreground transition-all outline-none",
                      "border-border-strong focus:border-brand focus:ring-2 focus:ring-brand/20",
                      portValidation &&
                        "border-destructive focus:border-destructive focus:ring-destructive/20",
                    )}
                    aria-label={t("takeover.mixedPort")}
                    type="number"
                    min="0"
                    max="65535"
                    placeholder={String(mixedPort)}
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value);
                      if (portValidation) setPortValidation("");
                    }}
                    disabled={
                      pending ||
                      (isLocalTarget && !hasLocalAPI) ||
                      (!hasLocalAPI && !caps.editPorts)
                    }
                  />
                  <Button
                    size="sm"
                    disabled={
                      pending ||
                      !port ||
                      port === String(mixedPort) ||
                      (isLocalTarget && !hasLocalAPI) ||
                      (!hasLocalAPI && !caps.editPorts)
                    }
                    onClick={() => void savePort()}
                    className="h-9 font-medium"
                  >
                    {tc("confirm")}
                  </Button>
                </div>
              </div>

              {portValidation && (
                <p role="alert" className="text-xs text-destructive">
                  {portValidation}
                </p>
              )}

              {hasLocalAPI && Boolean(status?.preferences.portOverride) && (
                <div className="flex items-center justify-start pt-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        await setMode({ port: 0 });
                        await refresh();
                      })
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-colors hover:underline"
                  >
                    {t("takeover.portFollowSubscription")}
                  </button>
                </div>
              )}
            </div>

            {/* Allow LAN */}
            <SettingRow
              title={t("takeover.allowLan")}
              description={t("takeover.allowLanDesc")}
            >
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
            </SettingRow>

            {/* Terminal Commands Widget */}
            <div className="-mx-3 flex flex-col gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-row-hover/50">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Terminal
                      className="size-4 text-brand shrink-0"
                      aria-hidden="true"
                    />
                    <strong className="text-body font-semibold text-foreground tracking-tight">
                      {t("terminalCommand")}
                    </strong>
                  </div>
                  <span className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                    {t("terminalCommandDesc")}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 whitespace-nowrap transition-colors"
                    onClick={copyTerminalCommand}
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 text-success" />
                        <span className="text-success font-medium">
                          {tc("copied")}
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 text-muted-foreground" />
                        <span>{tc("copy")}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Code Surface */}
              <div className="relative flex items-center justify-between rounded-xl border border-border bg-surface-inset p-3.5 shadow-inner">
                <code className="block w-full select-all break-all font-mono text-xs text-foreground tracking-tight">
                  {terminalCommands[terminalFormat]}
                </code>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: 進階與核心 (Advanced & Core) */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 ring-1 ring-brand/20">
                <Cpu className="size-4.5 text-brand" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <h2 className="m-0 text-base font-semibold text-foreground">
                  {t("advanced")}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t("advancedDesc")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Log Level */}
            <SettingRow
              title={t("about.logLevel")}
              description={t("advancedActions.logLevelDesc")}
            >
              <ButtonSelect<string>
                value={general.logLevel || "info"}
                disabled={pending}
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
            </SettingRow>

            {/* Core Runtime Overview */}
            <SettingRow
              title={t("advancedActions.coreRuntime")}
              description={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>
                    {t("core.engine")}:{" "}
                    <strong className="font-semibold text-foreground">
                      {clientInfo.type}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    {t("core.controllerAddress")}:{" "}
                    <code className="font-mono text-label text-foreground">
                      {controller.hostname || "127.0.0.1"}
                      {controller.port ? `:${controller.port}` : ""}
                    </code>
                  </span>
                </span>
              }
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/config")}
                className="gap-1.5 font-medium"
              >
                {t("advancedActions.manageControllers")}
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </Button>
            </SettingRow>

            {/* Navigation Tiles (Rules & Diagnostics) */}
            <div className="-mx-3 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/rules")}
                  className="group flex items-center justify-between rounded-xl border border-border bg-inset/40 p-3.5 text-left transition-all duration-150 hover:border-brand/40 hover:bg-row-hover/70 hover:shadow-xs active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-2xs transition-colors group-hover:border-brand/30 group-hover:text-brand">
                      <ListFilter className="size-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-body font-semibold text-foreground transition-colors group-hover:text-brand">
                        {t("advancedActions.rules")}
                      </span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {t("advancedActions.rulesDesc")}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/diagnostics")}
                  className="group flex items-center justify-between rounded-xl border border-border bg-inset/40 p-3.5 text-left transition-all duration-150 hover:border-brand/40 hover:bg-row-hover/70 hover:shadow-xs active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-2xs transition-colors group-hover:border-brand/30 group-hover:text-brand">
                      <Activity className="size-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-body font-semibold text-foreground transition-colors group-hover:text-brand">
                        {t("advancedActions.diagnostics")}
                      </span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {t("advancedActions.diagnosticsDesc")}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: 關於 (About System Sheet) */}
        <section className="flex flex-col rounded-card border border-border bg-card p-6 shadow-elevation-card">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-border">
            <div className="flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-inset p-2.5 shadow-xs">
                <XBondIcon className="size-7" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h2 className="m-0 text-base font-semibold text-foreground">
                    XBond {isDesktop ? "Desktop" : "Client"}
                  </h2>
                  <span className="rounded-md border border-border bg-inset px-1.5 py-0.5 font-mono text-label font-semibold text-foreground">
                    v{DASHBOARD_VERSION}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("aboutDesc")}
                </span>
              </div>
            </div>

            {/* Daemon Connectivity Beacon */}
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-inset px-3 py-1.5 text-xs">
              <span
                className={cn(
                  "size-2 rounded-full",
                  hasLocalAPI
                    ? "bg-success"
                    : isLocalTarget
                      ? "bg-warning"
                      : "bg-muted-foreground/40",
                )}
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {hasLocalAPI
                  ? t("core.daemonRunning")
                  : isLocalTarget
                    ? t("core.daemonOffline")
                    : t("core.localApiNone")}
              </span>
            </div>
          </div>

          {/* Precision Spec Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-inset/50 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {t("about.appVersion")}
              </span>
              <span className="font-mono text-xs font-semibold text-foreground">
                {DASHBOARD_VERSION}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-inset/50 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {t("about.coreVersion")}
              </span>
              <span className="font-mono text-xs font-semibold text-foreground">
                {clientInfo.type} {clientInfo.version || version.version || "—"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-inset/50 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {t("core.localApi")}
              </span>
              <span className="text-xs font-medium text-foreground">
                {hasLocalAPI
                  ? t("core.localApiRunning")
                  : isLocalTarget
                    ? t("core.localApiDown")
                    : t("core.localApiNone")}
              </span>
            </div>

            <a
              href="https://github.com/openxbond/xbond"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-xl border border-border/60 bg-inset/50 px-4 py-3 transition-colors hover:border-brand/40 hover:bg-row-hover/60"
            >
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                {t("about.openSource")}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-brand transition-colors group-hover:underline">
                GitHub Repository
                <ExternalLink className="size-3" />
              </span>
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
