import { Button, Input } from "@components";
import { CopyButton } from "@components/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import { cn } from "@lib/utils";
import {
  DAEMON_CONTROLLER_ID,
  useAPIInfo,
  useConfigurationOperation,
  useControllers,
  useSelectController,
} from "@stores";
import {
  createControllerId,
  normalizeControllerURL,
  type Controller,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import {
  Activity,
  AlertCircle,
  Check,
  Globe,
  Pencil,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ResourceIcon } from "./ResourceIcon";

export default function ControllerDetail({
  controller,
  onSaved,
  onRemoved,
}: {
  controller?: Controller;
  onSaved: (id: string) => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation("settings");
  const { t: c } = useTranslation("configuration");
  const { t: common } = useTranslation("common");
  const [controllers, setControllers] = useControllers();
  const target = useAPIInfo();
  const select = useSelectController();
  const { operation } = useConfigurationOperation();
  const [name, setName] = useState(controller?.name || "");
  const [url, setURL] = useState(controller?.url || "");
  const [secret, setSecret] = useState(controller?.secret || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState(!controller);

  const viewing =
    !!controller &&
    target.targetKind === "controller" &&
    target.id === controller.id &&
    target.url === controller.url;

  function values() {
    return {
      id:
        controller?.id &&
        !(hasDaemonConfig() && controller.id === DAEMON_CONTROLLER_ID)
          ? controller.id
          : createControllerId(),
      name: name.trim() || new URL(normalizeControllerURL(url)).host,
      url: normalizeControllerURL(url),
      secret: secret.trim(),
    };
  }

  function save(event?: React.FormEvent) {
    if (event) event.preventDefault();
    setError("");
    try {
      const item = values();
      setControllers(
        controllers.some((existing) => existing.id === item.id)
          ? controllers.map((existing) =>
              existing.id === item.id ? item : existing,
            )
          : [...controllers, item],
      );
      setEditing(false);
      setNotice(c("saved"));
      onSaved(item.id);
    } catch {
      setError(t("external.invalidURL"));
    }
  }

  async function test() {
    if (pending) return;
    setPending(true);
    setError("");
    setVersion("");
    setNotice("");
    try {
      const item = values();
      const result = await Client.forController(
        item.url,
        item.secret,
      ).getVersion();
      setVersion(result.data.version);
      setNotice(t("external.testOK"));
    } catch {
      setError(t("external.testFailed"));
    } finally {
      setPending(false);
    }
  }

  function remove() {
    if (!controller) return;
    const remaining = controllers.filter((item) => item.id !== controller.id);
    if (target.id === controller.id) {
      const fallback =
        remaining.find((item) => item.id !== DAEMON_CONTROLLER_ID) ||
        remaining[0];
      if (fallback) select(fallback.id);
    }
    setControllers(remaining);
    onRemoved();
  }

  const hostDisplay = (() => {
    if (!controller?.url) return "";
    try {
      return new URL(controller.url).host;
    } catch {
      return controller.url;
    }
  })();

  return (
    <div className="w-full space-y-6">
      {/* 1. Unified Top Header */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <ResourceIcon
            kind="controller"
            className="size-12 shrink-0 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {controller
                  ? controller.name || hostDisplay
                  : c("addController")}
              </h2>
              {controller && !editing && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  title={c("edit")}
                  onClick={() => {
                    setName(controller.name || "");
                    setURL(controller.url || "");
                    setSecret(controller.secret || "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                CLASH API
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {c("controllers")}
              </span>
              {hostDisplay && (
                <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {hostDisplay}
                </span>
              )}
              {viewing && (
                <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">
                  <Check className="size-3" />
                  {c("activeLocal")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Top-Right Action Buttons (Unified Position with SubscriptionDetail & AccountPanel) */}
        {controller && (
          <div className="flex shrink-0 items-center gap-2.5">
            <Button
              variant="outline"
              disabled={pending}
              className="gap-2"
              onClick={() => void test()}
            >
              <Activity className={cn("size-4", pending && "animate-spin")} />
              {pending ? common("loading") : t("external.test")}
            </Button>

            {viewing ? (
              <Button
                variant="secondary"
                disabled
                className="pointer-events-none gap-1.5"
              >
                <Check className="size-4 text-emerald-500" />
                {c("activeLocal")}
              </Button>
            ) : (
              <Button
                variant="brand"
                className="gap-1.5"
                onClick={() => select(controller.id)}
                disabled={Boolean(operation)}
              >
                <Zap className="size-4" />
                {c("use")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Connectivity Status Alerts */}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="size-4 shrink-0" />
          <span>
            {notice}
            {version && ` · ${version}`}
          </span>
        </div>
      )}

      {error && (
        <div
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* External Mode Notice */}
      {viewing && (
        <div className="rounded-xl border border-border bg-surface-inset p-3.5 text-xs text-muted-foreground leading-relaxed">
          {c("externalModeNotice")}
        </div>
      )}

      {/* Main Body */}
      {controller ? (
        <>
          {/* 2. Connection Details Card */}
          <div className="rounded-card border bg-card p-5 shadow-elevation-card space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t("external.url")}
            </h3>
            <div className="flex items-center gap-2 rounded-control border border-border bg-inset px-3 py-2">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 select-all truncate font-mono text-xs text-foreground">
                {controller.url}
              </span>
              <CopyButton value={controller.url} label={common("copy")} />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                onClick={() => {
                  setName(controller.name || "");
                  setURL(controller.url || "");
                  setSecret(controller.secret || "");
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" />
                {c("edit")}
              </Button>
            </div>

            <div className="grid gap-3 pt-2 text-xs sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="text-muted-foreground">
                  {t("about.coreVersion")}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {version || c("unverified")}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="text-muted-foreground">
                  {t("external.secret")}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {controller.secret ? "••••••••" : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Danger Zone Card (Bottom) */}
          {controller.id !== DAEMON_CONTROLLER_ID && (
            <div className="rounded-card border border-destructive/25 bg-destructive/[0.03] p-5 shadow-elevation-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <Trash2 className="size-4" />
                  {c("removeController")}
                </h3>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  {c("controllerRemoveConfirm")}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="shrink-0"
                onClick={() => setConfirmRemove(true)}
              >
                {c("removeController")}
              </Button>
            </div>
          )}

          {/* Edit Dialog for Existing Controller */}
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogContent
              closeLabel={common("close")}
              className="sm:max-w-[500px]"
            >
              <DialogHeader>
                <DialogTitle>{c("edit")}</DialogTitle>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={save}>
                <label className="grid gap-2 text-sm">
                  {t("external.name")}
                  <Input
                    value={name}
                    disabled={pending}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  {t("external.url")}
                  <Input
                    value={url}
                    required
                    placeholder="http://127.0.0.1:9090"
                    disabled={pending}
                    onChange={(e) => setURL(e.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  {t("external.secret")}
                  <Input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    disabled={pending}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </label>
                <DialogFooter className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setEditing(false)}
                  >
                    {common("cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || !url.trim()}
                    onClick={() => void test()}
                  >
                    {pending ? common("loading") : t("external.test")}
                  </Button>
                  <Button
                    type="submit"
                    variant="brand"
                    disabled={pending || !url.trim()}
                  >
                    {c("save")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        /* Add New Controller Screen */
        <div className="rounded-card border bg-card p-6 shadow-elevation-card space-y-5 max-w-2xl">
          <form className="grid gap-5" onSubmit={save}>
            <label className="grid gap-2 text-sm">
              {t("external.name")}
              <Input
                value={name}
                disabled={pending}
                placeholder="My Remote Core"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t("external.url")}
              <Input
                value={url}
                required
                placeholder="http://127.0.0.1:9090"
                disabled={pending}
                onChange={(event) => {
                  setURL(event.target.value);
                  setVersion("");
                  setNotice("");
                }}
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t("external.secret")}
              <Input
                type="password"
                autoComplete="off"
                value={secret}
                disabled={pending}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setVersion("");
                  setNotice("");
                }}
              />
            </label>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="submit"
                variant="brand"
                disabled={pending || !url.trim()}
              >
                {c("save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !url.trim()}
                onClick={() => void test()}
              >
                {pending ? common("loading") : t("external.test")}
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("external.note")}
            </p>
          </form>
        </div>
      )}

      {/* Confirmation Dialog: Remove Controller */}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent closeLabel={common("close")}>
          <DialogHeader>
            <DialogTitle>{c("removeController")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {c("controllerRemoveConfirm")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              {common("cancel")}
            </Button>
            <Button variant="destructive" onClick={remove}>
              {c("removeController")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
