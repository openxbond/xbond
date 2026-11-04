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
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Header } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { XBondIcon } from "@/components/xbond-icon";
import { useAction } from "@/hooks/use-action";
import type { Lang } from "@/i18n/instance";
import { cn } from "@/lib/utils";
import { isClashX } from "@/platform/clashx-bridge";
import { invokeDesktop, isDesktopApp } from "@/platform/local-api-bootstrap";
import { openExternalUrl } from "@/platform/open-external";
import { useAPIInfo, useClient } from "@/state/controller-target";
import { useCapabilities, useGeneral, useVersion } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";
import {
  desktopPreferencesAtom,
  themeAtom,
  useConfig,
  useLanguage,
  type ThemePreference,
} from "@/state/user-preferences";

import { DASHBOARD_VERSION, parseClientInfo } from "./client-version";
import {
  proxyEndpoint,
  proxyTerminalCommand,
  type ProxyTerminalFormat,
} from "./proxy-terminal-command";

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
  const { t, i18n } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
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
  const [portFeedback, setPortFeedback] = useState<"" | "saved" | "failed">("");
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

  // Desktop host capabilities are real OS state, not just localStorage: the
  // shell's answer wins on mount, and toggles push down to the OS.
  useEffect(() => {
    const invoke = invokeDesktop();
    if (!isDesktop || !invoke) return;
    void invoke("get_autostart").then((enabled) => {
      if (typeof enabled === "boolean")
        setDesktopPrefs((prev) =>
          prev.autostart === enabled ? prev : { ...prev, autostart: enabled },
        );
    });
    void invoke("get_close_to_tray").then((value) => {
      if (typeof value === "boolean")
        setDesktopPrefs((prev) =>
          prev.closeToTray === value ? prev : { ...prev, closeToTray: value },
        );
    });
  }, [isDesktop, setDesktopPrefs]);

  async function toggleAutostart(enable: boolean) {
    const invoke = invokeDesktop();
    if (!invoke) return;
    setDesktopPrefs((prev) => ({ ...prev, autostart: enable }));
    try {
      const enabled = await invoke("set_autostart", { enable });
      if (typeof enabled === "boolean" && enabled !== enable)
        setDesktopPrefs((prev) => ({ ...prev, autostart: enabled }));
    } catch (err) {
      // Registration can genuinely fail (policy-blocked run keys): revert
      // and surface it instead of showing a switch that lies.
      setDesktopPrefs((prev) => ({ ...prev, autostart: !enable }));
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleCloseToTray(value: boolean) {
    setDesktopPrefs((prev) => ({ ...prev, closeToTray: value }));
    void invokeDesktop()?.("set_close_to_tray", { value });
  }

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
    setPortFeedback("");
    const parsed = Number(currentPort);
    // 儲存回應留在欄位旁：成功顯示「已儲存」，失敗留下可讀錯誤，
    // 不只依賴全域 toast。
    const ok = await run(async () => {
      if (hasLocalAPI) {
        await setMode({ port: parsed });
        await refresh();
      } else {
        await client.updateConfig({ "mixed-port": parsed });
        await update();
      }
      setPort("");
    }, false);
    if (ok) {
      setPortFeedback("saved");
      setTimeout(() => setPortFeedback(""), 2400);
    } else {
      setPortFeedback("failed");
    }
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
        <Card className="flex flex-col p-6">
          <CardHeader className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-control bg-inset ring-1 ring-border">
                <Sliders
                  className="size-4.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="flex flex-col">
                <CardTitle>{t("preferences")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("generalDesc")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <Separator className="mb-5" />
          <CardContent className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Theme */}
            <SettingRow title={t("theme")} description={t("themeDesc")}>
              <SegmentedControl<ThemePreference>
                ariaLabel={t("theme")}
                value={theme ?? "system"}
                options={[
                  { value: "system", label: t("system") },
                  { value: "light", label: t("light") },
                  { value: "dark", label: t("dark") },
                ]}
                onChange={setTheme}
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
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="zh_HK">繁體中文 (香港)</SelectItem>
                    <SelectItem value="zh_CN">简体中文</SelectItem>
                    <SelectItem value="en_US">English</SelectItem>
                    <SelectItem value="ko">한국어</SelectItem>
                    <SelectItem value="fa">فارسی</SelectItem>
                  </SelectGroup>
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
                    <Badge variant="outline" className="uppercase">
                      {t("desktop.hostDesktop")}
                    </Badge>
                  }
                >
                  <Switch
                    aria-label={t("desktop.autostart")}
                    checked={desktopPrefs.autostart}
                    onCheckedChange={(val) => void toggleAutostart(val)}
                  />
                </SettingRow>

                <SettingRow
                  title={t("desktop.closeToTray")}
                  description={t("desktop.closeToTrayDesc")}
                  badge={
                    <Badge variant="outline" className="uppercase">
                      {t("desktop.hostDesktop")}
                    </Badge>
                  }
                >
                  <Switch
                    aria-label={t("desktop.closeToTray")}
                    checked={desktopPrefs.closeToTray}
                    onCheckedChange={toggleCloseToTray}
                  />
                </SettingRow>
              </>
            )}
          </CardContent>
        </Card>

        {/* Section 2: 網絡與連接埠 (Network & Ports) */}
        <Card className="flex flex-col p-6">
          <CardHeader className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-control bg-inset ring-1 ring-border">
                <Network
                  className="size-4.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="flex flex-col">
                <CardTitle>{t("network")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("networkDesc")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <Separator className="mb-5" />
          <CardContent className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Mixed Port */}
            <div className="-mx-3 flex flex-col gap-2.5 rounded-xl p-3 transition-colors duration-150 hover:bg-row-hover/50">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-body font-semibold text-foreground tracking-tight">
                      {t("takeover.mixedPort")}
                    </strong>
                    {status?.preferences.portOverride ? (
                      <Badge variant="brand">
                        <span className="size-1.5 rounded-full bg-brand" />
                        {t("takeover.portNoteOverride", {
                          port: status.preferences.portOverride,
                        })}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                        {status?.preferences.portSource === "subscription"
                          ? t("takeover.portNoteSubscription")
                          : t("takeover.portNoteDefault")}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                    {t("takeover.mixedPortDesc")}
                  </span>
                </div>

                <Field
                  orientation="horizontal"
                  data-invalid={Boolean(portValidation)}
                  className="w-auto gap-2"
                >
                  <Input
                    className="w-28 font-mono"
                    aria-invalid={Boolean(portValidation)}
                    aria-describedby={
                      portValidation ? "mixed-port-error" : undefined
                    }
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
                </Field>
              </div>

              {portValidation && (
                <FieldError id="mixed-port-error">{portValidation}</FieldError>
              )}

              {portFeedback && (
                <p
                  role={portFeedback === "failed" ? "alert" : "status"}
                  className={
                    portFeedback === "failed"
                      ? "text-xs text-destructive-text"
                      : "text-xs text-success-text"
                  }
                >
                  {portFeedback === "saved"
                    ? tc("saved")
                    : t("takeover.portSaveFailed")}
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
            <Tabs
              value={terminalFormat}
              dir={i18n.dir()}
              activationMode="manual"
              onValueChange={(value) => {
                if (
                  value === "powershell" ||
                  value === "cmd" ||
                  value === "bash"
                )
                  setTerminalFormat(value);
              }}
              className="-mx-3 gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-row-hover/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
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

                <div className="flex max-w-full flex-wrap items-center gap-2">
                  <TabsList aria-label={t("terminalCommand")}>
                    <TabsTrigger value="powershell">PowerShell</TabsTrigger>
                    <TabsTrigger value="cmd">CMD</TabsTrigger>
                    <TabsTrigger value="bash">Bash / Zsh</TabsTrigger>
                  </TabsList>
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

              {(["powershell", "cmd", "bash"] as const).map((format) => (
                <TabsContent
                  key={format}
                  value={format}
                  className="rounded-xl border border-border bg-inset p-3.5 shadow-inner"
                >
                  <code className="block w-full select-all break-all font-mono text-xs text-foreground tracking-tight">
                    {terminalCommands[format]}
                  </code>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Section 3: 進階與核心 (Advanced & Core) */}
        <Card className="flex flex-col p-6">
          <CardHeader className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-control bg-inset ring-1 ring-border">
                <Cpu
                  className="size-4.5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="flex flex-col">
                <CardTitle>{t("advanced")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("advancedDesc")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <Separator className="mb-5" />
          <CardContent className="flex flex-col gap-1 divide-y divide-border/40 [&>*:not(:first-child)]:pt-3.5">
            {/* Log Level */}
            <SettingRow
              title={t("about.logLevel")}
              description={t("advancedActions.logLevelDesc")}
            >
              <SegmentedControl
                ariaLabel={t("about.logLevel")}
                value={general.logLevel || "info"}
                disabled={pending}
                options={[
                  { value: "debug", label: "Debug" },
                  { value: "info", label: "Info" },
                  { value: "warn", label: "Warn" },
                  { value: "error", label: "Error" },
                  { value: "silent", label: "Silent" },
                ]}
                onChange={(level) =>
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
                    <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-2xs transition-colors group-hover:border-border-strong group-hover:text-foreground">
                      <ListFilter className="size-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-body font-semibold text-foreground transition-colors group-hover:text-foreground">
                        {t("advancedActions.rules")}
                      </span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {t("advancedActions.rulesDesc")}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/diagnostics")}
                  className="group flex items-center justify-between rounded-xl border border-border bg-inset/40 p-3.5 text-left transition-all duration-150 hover:border-brand/40 hover:bg-row-hover/70 hover:shadow-xs active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-2xs transition-colors group-hover:border-border-strong group-hover:text-foreground">
                      <Activity className="size-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-body font-semibold text-foreground transition-colors group-hover:text-foreground">
                        {t("advancedActions.diagnostics")}
                      </span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {t("advancedActions.diagnosticsDesc")}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 4: 關於 (About System Sheet) */}
        <Card className="flex flex-col p-6">
          <CardHeader className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-inset p-2.5 shadow-xs">
                <XBondIcon className="size-7" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <CardTitle>
                    XBond{" "}
                    {isDesktop
                      ? t("desktop.hostDesktop")
                      : t("desktop.hostClient")}
                  </CardTitle>
                  <span className="rounded-md border border-border bg-inset px-1.5 py-0.5 font-mono text-label font-semibold text-foreground">
                    v{DASHBOARD_VERSION}
                  </span>
                </div>
                <CardDescription className="text-xs">
                  {t("aboutDesc")}
                </CardDescription>
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
          </CardHeader>
          <Separator className="mb-5" />
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              onClick={(event) => {
                if (!isDesktopApp()) return;
                event.preventDefault();
                openExternalUrl("https://github.com/openxbond/xbond").catch(
                  (err: unknown) => toast.error(String(err)),
                );
              }}
            >
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                {t("about.openSource")}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-brand transition-colors group-hover:underline">
                GitHub Repository
                <ExternalLink className="size-3" />
              </span>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
