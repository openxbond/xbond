import { Button, Input } from "@components";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@components/ui/dialog";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import {
  useControllers,
  useAPIInfo,
  useSelectController,
  DAEMON_CONTROLLER_ID,
} from "@stores";
import {
  createControllerId,
  normalizeControllerURL,
  type Controller,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
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
  function save(event: React.FormEvent) {
    event.preventDefault();
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
  return (
    <div className="config-detail-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <ResourceIcon kind="controller" className="size-14" />
          <div className="min-w-0">
            <h2 className="break-words text-title font-semibold">
              {controller?.name || c("addController")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {c("controllers")}
            </p>
          </div>
        </div>
        {viewing && <span className="config-status">{c("viewing")}</span>}
      </div>
      {!editing && controller ? (
        <>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="brand"
              onClick={() => select(controller.id)}
              disabled={viewing}
            >
              {c("viewController")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void test()}
              disabled={pending}
            >
              {pending ? common("loading") : t("external.test")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(true);
                setNotice("");
              }}
            >
              {c("edit")}
            </Button>
          </div>
          <dl className="config-facts">
            <div>
              <dt>{t("external.url")}</dt>
              <dd className="break-all" dir="ltr">
                {controller.url}
              </dd>
            </div>
            <div>
              <dt>{t("about.coreVersion")}</dt>
              <dd>{version || c("unverified")}</dd>
            </div>
          </dl>
          {controller.id !== DAEMON_CONTROLLER_ID && (
            <div className="border-t border-border pt-5">
              <Button
                variant="destructive"
                onClick={() => setConfirmRemove(true)}
              >
                {c("removeController")}
              </Button>
            </div>
          )}
        </>
      ) : (
        <form className="grid max-w-2xl gap-5" onSubmit={save}>
          <label className="grid gap-2 text-sm">
            {t("external.name")}
            <Input
              value={name}
              disabled={pending}
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
          <div className="flex flex-wrap gap-3">
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
            {controller && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setName(controller.name);
                  setURL(controller.url);
                  setSecret(controller.secret);
                  setError("");
                  setNotice("");
                  setVersion("");
                  setEditing(false);
                }}
              >
                {common("cancel")}
              </Button>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("external.note")}
          </p>
        </form>
      )}
      {notice && (
        <p role="status" className="text-sm text-success-text">
          {notice}
          {version && ` · ${version}`}
        </p>
      )}
      {error && (
        <p className="config-error" role="alert">
          {error}
        </p>
      )}
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
