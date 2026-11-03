import { Input, Button } from "@components";
import { CopyButton } from "@components/CopyButton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { useAction } from "@lib/actions";
import { useObject } from "@lib/hook";
import { cn } from "@lib/utils";
import {
  useAPIInfo,
  identityAtom,
  externalControllerModalAtom,
  useControllers,
  useSelectController,
} from "@stores";
import {
  normalizeControllerURL,
  createControllerId,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

export default function ExternalController({
  createOnly = false,
}: {
  createOnly?: boolean;
}) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const controller = useAPIInfo();
  const [identity, setIdentity] = useAtom(identityAtom);
  const [modalState, setModalState] = useAtom(externalControllerModalAtom);
  const isOpen = modalState.open || !identity;
  const isCreateOnly = modalState.open
    ? (modalState.createOnly ?? createOnly)
    : createOnly;

  const [value, set] = useObject({ name: "", url: "", secret: "" });
  const [hosts, setter] = useControllers();
  const select = useSelectController();
  const { run, pending } = useAction();
  const { mutate } = useSWRConfig();
  // Browser-restriction help stays hidden until a connection test actually
  // fails, then surfaces as a "can't connect?" prompt with details on demand.
  const [testFailed, setTestFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [urlError, setUrlError] = useState<
    "" | "invalidURL" | "invalidPortRange"
  >("");
  // Every close path (save, remove, dismiss) routes through close() — the one
  // place transient test UI resets, so reopening the dialog starts clean.
  function close() {
    setTestFailed(false);
    setHelpOpen(false);
    setUrlError("");
    setIdentity(true);
    setModalState({ open: false, createOnly: false });
  }
  useEffect(() => {
    if (!isOpen) return;
    set(
      isCreateOnly
        ? { name: "", url: "", secret: "" }
        : {
            name: controller.name,
            url: controller.url,
            secret: controller.secret,
          },
    );
  }, [
    isOpen,
    isCreateOnly,
    controller.name,
    controller.url,
    controller.secret,
    set,
  ]);

  function validated() {
    const text = value.url.trim();
    // Name the actual problem: an out-of-range port is by far the common case
    // and deserves its own message instead of a generic "invalid URL".
    const port = text.match(/:(\d+)(?:[/?#]|$)/);
    if (port && Number(port[1]) > 65535) {
      setUrlError("invalidPortRange");
      return null;
    }
    try {
      setUrlError("");
      return { ...value, url: normalizeControllerURL(text) };
    } catch {
      setUrlError("invalidURL");
      return null;
    }
  }
  function save(add = false) {
    const item = validated();
    if (!item) return;
    const id = add ? createControllerId() : controller.id;
    setter((current) => {
      const list = Array.isArray(current) ? current : hosts;
      return add
        ? [...list, { ...item, id }]
        : list.some((h) => h.id === id)
          ? list.map((h) => (h.id === id ? { ...item, id } : h))
          : [...list, { ...item, id }];
    });
    select(id);
    close();
    const client = Client.forController(item.url, item.secret);
    void mutate((key) => Array.isArray(key) && key[1] === client).catch(
      () => {},
    );
  }
  function remove() {
    const next = hosts.filter((h) => h.id !== controller.id);
    if (!next.length) return;
    setter(next);
    select(next[0].id);
    close();
  }
  async function test() {
    const item = validated();
    if (!item) return;
    setTestFailed(false);
    const ok = await run(async () => {
      await new Client(item.url, item.secret).getVersion();
      toast.success(t("external.testOK"));
    }, false);
    if (!ok) setTestFailed(true);
  }
  // chrome:// and edge:// cannot be opened from page content; surface the
  // exact settings address for the current browser so it can be pasted into
  // the address bar. Local network access has no stable settings page, so it
  // stays as text guidance.
  const scheme = navigator.userAgent.includes("Edg/") ? "edge" : "chrome";
  const insecureURL = `${scheme}://settings/content/insecureContent`;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent
        closeLabel={tc("close")}
        className="max-w-[calc(100vw-32px)] sm:max-w-[500px]"
      >
        <DialogHeader>
          <DialogTitle>{t("external.title")}</DialogTitle>
        </DialogHeader>
        <div>
          <p className="mb-5 text-body leading-[1.6] text-muted-foreground">
            {t("external.note")}
          </p>
          <div className="flex flex-col gap-4">
            <label className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3">
              <span className="text-body font-medium leading-[34px] text-muted-foreground">
                {t("external.name")}
              </span>
              <Input
                aria-label={t("external.name")}
                className="h-[34px]"
                value={value.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3">
              <span className="text-body font-medium leading-[34px] text-muted-foreground">
                {t("external.url")}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Input
                  aria-label={t("external.url")}
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? "ec-url-error" : undefined}
                  className="h-[34px]"
                  value={value.url}
                  placeholder="http://127.0.0.1:9090"
                  onChange={(e) => {
                    setUrlError("");
                    set("url", e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(createOnly);
                  }}
                />
                {urlError && (
                  <p
                    className="m-0 text-xs leading-normal text-destructive"
                    id="ec-url-error"
                    role="alert"
                  >
                    {t(`external.${urlError}`)}
                  </p>
                )}
              </div>
            </label>
            <label className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3">
              <span className="text-body font-medium leading-[34px] text-muted-foreground">
                {t("external.secret")}
              </span>
              <div className="flex min-w-0 items-center gap-2.5">
                <Input
                  aria-label={t("external.secret")}
                  type="password"
                  className="h-[34px]"
                  value={value.secret}
                  onChange={(e) => set("secret", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(createOnly);
                  }}
                />
                <Button
                  className="h-[34px] shrink-0 px-3.5 text-body"
                  disabled={pending}
                  onClick={test}
                >
                  {pending ? t("external.connecting") : t("external.test")}
                </Button>
              </div>
            </label>
          </div>
          {testFailed && (
            <div className="mt-5 border-t border-border pt-4 text-xs leading-[1.7] text-muted-foreground">
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-none p-0 text-xs font-semibold text-brand-text hover:underline hover:underline-offset-4"
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen((open) => !open)}
              >
                {t("external.helpTrigger")}
                <svg
                  className={cn(
                    "transition-transform duration-150 motion-reduce:transition-none",
                    helpOpen && "rotate-180",
                  )}
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {helpOpen && (
                <div className="mt-2.5">
                  <p className="m-0 [overflow-wrap:anywhere]">
                    {t("external.browserNote")}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("external.allowInsecure")}
                    </span>
                    <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-[6px] border border-border bg-inset px-2.5 py-1.5 font-mono text-label text-foreground select-all">
                      {insecureURL}
                    </code>
                    <CopyButton
                      value={insecureURL}
                      label={t("external.copyFlag")}
                    />
                  </div>
                  <p className="m-0 mt-2.5 [overflow-wrap:anywhere]">
                    {t("external.localNetworkNote")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter
          className={isCreateOnly ? undefined : "sm:justify-between"}
        >
          {!isCreateOnly && (
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => save(true)}>
                {t("external.add")}
              </Button>
              <Button
                variant="destructive"
                disabled={pending || hosts.length < 2}
                onClick={remove}
              >
                {t("external.delete")}
              </Button>
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" disabled={pending} onClick={close}>
              {tc("cancel")}
            </Button>
            <Button disabled={pending} onClick={() => save(isCreateOnly)}>
              {tc("ok")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
