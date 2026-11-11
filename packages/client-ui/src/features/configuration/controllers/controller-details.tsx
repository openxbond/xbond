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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CopyButton } from "@/components/copy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import {
  useAPIInfo,
  useExternals,
  useSelectTarget,
} from "@/state/controller-target";

import { useConfigurationOperation } from "../configuration-operation";
import { ResourceIcon } from "../configuration-resource-icon";

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
  const [controllers, setControllers] = useExternals();
  const target = useAPIInfo();
  const select = useSelectTarget();
  const { operation } = useConfigurationOperation();
  const [name, setName] = useState(controller?.name || "");
  // 純 web 部署下頁面與核心同源，直接預填當前位址，省去查找位址與埠的步驟。
  const [url, setURL] = useState(
    controller?.url || (hasDaemonConfig() ? "" : window.location.origin),
  );
  const [secret, setSecret] = useState(controller?.secret || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(!controller);

  const viewing =
    !!controller &&
    target.targetKind === "controller" &&
    target.controller.id === controller.id;

  function values() {
    return {
      id: controller?.id ?? createControllerId(),
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
    if (
      target.targetKind === "controller" &&
      target.controller.id === controller.id
    ) {
      const fallback = remaining[0];
      select(
        fallback ? { kind: "controller", id: fallback.id } : { kind: "daemon" },
      );
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
    <div className="flex flex-col w-full gap-6">
      {/* 1. Unified Top Header */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-start gap-3.5">
          <ResourceIcon
            kind="controller"
            className="size-12 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-title font-semibold tracking-tight text-foreground">
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
              <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                CLASH API
              </span>
              <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {c("controllers")}
              </span>
              {hostDisplay && (
                <span className="rounded-md bg-muted px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {hostDisplay}
                </span>
              )}
              {viewing && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-text">
                  <Check className="size-3" strokeWidth={2.2} />
                  {c("activeLocal")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons Row */}
        {controller && (
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              disabled={pending}
              className="h-9 gap-2 rounded-control bg-card/90 px-3.5 shadow-2xs"
              onClick={() => void test()}
            >
              <Activity className={cn("size-3.5", pending && "animate-spin")} />
              {pending ? common("loading") : t("external.test")}
            </Button>

            {!viewing && (
              <Button
                variant="brand"
                className="h-9 gap-1.5 rounded-full px-4 shadow-xs cursor-pointer"
                onClick={() =>
                  select({ kind: "controller", id: controller.id })
                }
                disabled={Boolean(operation)}
              >
                <Zap className="size-3.5" />
                {c("use")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Connectivity Status Alerts */}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success-text">
          <Check className="size-4 shrink-0" />
          <span>
            {notice}
            {version && ` · ${version}`}
          </span>
        </div>
      )}

      {error && !editing && (
        <div
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive-text"
          role="alert"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* External Mode Notice */}
      {viewing && (
        <div className="rounded-xl border border-border bg-inset p-3.5 text-xs text-muted-foreground leading-relaxed">
          {c("externalModeNotice")}
        </div>
      )}

      {/* Main Body */}
      {controller ? (
        <>
          {/* 2. Connection Details Card */}
          <div className="flex flex-col rounded-card border bg-card p-5 shadow-elevation-card gap-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t("external.url")}
            </h3>
            <div className="flex items-center gap-2 rounded-control border border-border/80 bg-inset px-3 py-2">
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

            <div className="grid gap-3 pt-2 text-xs xl:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl bg-inset/70 px-3.5 py-2.5">
                <span className="text-muted-foreground">
                  {t("about.coreVersion")}
                </span>
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {version || c("unverified")}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-inset/70 px-3.5 py-2.5">
                <span className="text-muted-foreground">
                  {t("external.secret")}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {controller.secret ? "••••••••" : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Danger Zone Card (Bottom)：mt-auto 釘到卡底，讓工作台等高時
              的留白落在內容與危險區之間，而不是危險區下方一片空卡面 */}
          <div className="mt-auto rounded-card border border-destructive/25 bg-destructive/[0.03] p-5 shadow-elevation-card flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
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
              ref={removeTrigger}
              onClick={() => setConfirmRemove(true)}
            >
              {/* 標題已寫「刪除控制器」，按鈕不再逐字重複 */}
              {t("external.delete")}
            </Button>
          </div>

          {/* Edit Dialog for Existing Controller */}
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogContent
              closeLabel={common("close")}
              className="sm:max-w-[500px]"
            >
              <DialogHeader>
                <DialogTitle>{c("edit")}</DialogTitle>
              </DialogHeader>
              <form onSubmit={save}>
                <FieldGroup className="gap-4">
                  <Field className="gap-2" data-disabled={pending}>
                    <FieldLabel htmlFor="edit-controller-name">
                      {t("external.name")}
                    </FieldLabel>
                    <Input
                      id="edit-controller-name"
                      value={name}
                      disabled={pending}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field className="gap-2" data-disabled={pending}>
                    <FieldLabel htmlFor="edit-controller-url">
                      {t("external.url")}
                    </FieldLabel>
                    <Input
                      id="edit-controller-url"
                      value={url}
                      required
                      placeholder="http://127.0.0.1:9090"
                      disabled={pending}
                      onChange={(e) => {
                        setURL(e.target.value);
                        setVersion("");
                        setNotice("");
                        setError("");
                      }}
                    />
                  </Field>
                  <Field className="gap-2" data-disabled={pending}>
                    <FieldLabel htmlFor="edit-controller-secret">
                      {t("external.secret")}
                    </FieldLabel>
                    <Input
                      id="edit-controller-secret"
                      type="password"
                      autoComplete="off"
                      value={secret}
                      disabled={pending}
                      onChange={(e) => {
                        setSecret(e.target.value);
                        setVersion("");
                        setNotice("");
                        setError("");
                      }}
                    />
                  </Field>
                  {/* 儲存與測試的錯誤留在對話框內，否則會被遮罩擋住。 */}
                  {error && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 rounded-control border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-text"
                    >
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
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
                </FieldGroup>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        /* Add New Controller Screen */
        <div className="flex flex-col rounded-card border bg-card p-6 shadow-elevation-card gap-5 max-w-2xl">
          <form onSubmit={save}>
            <FieldGroup className="gap-5">
              <Field className="gap-2" data-disabled={pending}>
                <FieldLabel htmlFor="new-controller-name">
                  {t("external.name")}
                </FieldLabel>
                <Input
                  id="new-controller-name"
                  value={name}
                  disabled={pending}
                  placeholder="My Remote Core"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field className="gap-2" data-disabled={pending}>
                <FieldLabel htmlFor="new-controller-url">
                  {t("external.url")}
                </FieldLabel>
                <Input
                  id="new-controller-url"
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
              </Field>
              <Field className="gap-2" data-disabled={pending}>
                <FieldLabel htmlFor="new-controller-secret">
                  {t("external.secret")}
                </FieldLabel>
                <Input
                  id="new-controller-secret"
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
              </Field>
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
            </FieldGroup>
          </form>
        </div>
      )}

      {/* Confirmation Dialog: Remove Controller */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (removeTrigger.current?.isConnected) {
              event.preventDefault();
              removeTrigger.current.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c("removeController")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {c("controllerRemoveConfirm")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{common("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              {c("removeController")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
