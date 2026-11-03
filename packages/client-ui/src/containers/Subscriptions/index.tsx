import {
  Header,
  Button,
  ButtonSelect,
  Input,
  QuotaRing,
  Stat,
} from "@components";
import { CopyButton } from "@components/CopyButton";
import { RequestStatus } from "@components/RequestStatus";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { useAction } from "@lib/actions";
import { useLanguage, useLocalAPI, useSubscriptions } from "@stores";
import { formatTraffic } from "@xbond/client/helper";
import { subscriptionLang, subscriptionQuota } from "@xbond/client/localapi";
import { workspaceLink } from "@xbond/client/workspace";
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export default function Subscriptions() {
  const { lang } = useLanguage();
  const { t } = useTranslation("subscriptions");
  const { t: tc } = useTranslation("common");
  const { t: c } = useTranslation("connect");
  const { t: sb } = useTranslation("sidebar");
  const location = useLocation();
  const [params] = useSearchParams();
  const { hasLocalAPI, status, refresh, client: localClient } = useLocalAPI();
  const {
    subscriptions,
    activeId,
    addSub,
    selectSub,
    updateSub,
    removeSub,
    renameSub,
    error: subError,
    refresh: refreshSubs,
  } = useSubscriptions();

  const { run, pending } = useAction();
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [importError, setImportError] = useState("");
  const track = params.get("track") === "universal" ? "universal" : "xbond";
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importFeedback, setImportFeedback] = useState<
    "idle" | "success" | "failed"
  >("idle");
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overridePrepend, setOverridePrepend] = useState("");
  const [overrideAppend, setOverrideAppend] = useState("");
  const [overrideDns, setOverrideDns] = useState("");
  const [overrideError, setOverrideError] = useState("");
  const [proxyChannelId, setProxyChannelId] = useState<string | null>(null);
  const [proxyChannelUrl, setProxyChannelUrl] = useState("");
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorError, setEditorError] = useState("");

  const link = (values: Record<string, string> = {}) =>
    workspaceLink(location.search, "/subscriptions", values);

  function lines(value: string): string[] {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function openOverride(id: string) {
    setOverrideId(id);
    setOverrideError("");
    setOverridePrepend("");
    setOverrideAppend("");
    setOverrideDns("");
    if (!localClient) return;
    try {
      const current = await localClient.getSubOverride(id);
      setOverridePrepend((current.rulesPrepend ?? []).join("\n"));
      setOverrideAppend((current.rulesAppend ?? []).join("\n"));
      setOverrideDns(current.dns ?? "");
    } catch (error) {
      setOverrideError(String(error));
    }
  }

  async function saveOverride() {
    if (!overrideId || !localClient) return;
    setOverrideError("");
    try {
      await localClient.setSubOverride(overrideId, {
        rulesPrepend: lines(overridePrepend),
        rulesAppend: lines(overrideAppend),
        dns: overrideDns.trim() || undefined,
      });
      await refresh();
      setOverrideId(null);
      toast.success(t("overrideSaved"));
    } catch (error) {
      // Conflicts (missing policies, core-gate failures) stay in the dialog
      // so the text survives for editing.
      setOverrideError(error instanceof Error ? error.message : String(error));
    }
  }

  // Channel "proxy" needs a URL first: the modal collects it, other
  // channels persist immediately.
  function selectChannel(id: string, channel: "direct" | "self" | "proxy") {
    if (channel === "proxy") {
      setProxyChannelId(id);
      setProxyChannelUrl("");
      return;
    }
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      await localClient.setSubChannel(id, channel);
      await refresh();
    });
  }

  function saveProxyChannel() {
    if (!proxyChannelId || !localClient) return;
    void run(async () => {
      await localClient.setSubChannel(
        proxyChannelId,
        "proxy",
        proxyChannelUrl.trim(),
      );
      await refresh();
      setProxyChannelId(null);
    });
  }

  function rollback(id: string) {
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      await localClient.rollbackSub(id);
      await refresh();
      toast.success(t("rollbackDone"));
    });
  }

  async function openSourceEditor(id: string) {
    setEditorId(id);
    setEditorError("");
    if (!localClient) return;
    try {
      setEditorContent(await localClient.getSubSource(id));
    } catch (error) {
      setEditorContent("");
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  }

  function saveSourceEditor() {
    if (!editorId || !localClient) return;
    void run(async () => {
      try {
        await localClient.editSubSource(editorId, editorContent);
      } catch (error) {
        // Gate failures stay in the dialog so the text survives for editing.
        setEditorError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      await refresh();
      setEditorId(null);
      toast.success(t("sourceSaved"));
    }, false);
  }

  function resumeUpdates(id: string) {
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      await localClient.unpinSub(id);
      await refresh();
      toast.success(t("resumeUpdatesDone"));
    });
  }

  async function add() {
    setImportFeedback("idle");
    setImportError("");
    const ok = await run(async () => {
      const result = await addSub({
        ...(track === "xbond"
          ? { token: token.trim() }
          : { urlOrFile: url.trim() }),
        name: name.trim() || undefined,
        lang: subscriptionLang(lang),
      });
      await refresh();
      if (result.updateError) {
        setImportError(result.updateError);
        throw new Error(result.updateError);
      }
    }, false);
    if (ok) {
      setToken("");
      setUrl("");
      setName("");
      setImportFeedback("success");
      toast.success(t("imported"));
    } else {
      setImportFeedback("failed");
    }
  }

  return (
    <div className="page max-w-[1200px]">
      <Header title={t("title")}>
        <div className="flex items-center gap-2">
          {hasLocalAPI && subscriptions.length > 1 && (
            <Button
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  if (localClient) await localClient.updateSub();
                  await refresh();
                  await refreshSubs();
                })
              }
            >
              {t("updateBtn")}
            </Button>
          )}
        </div>
      </Header>

      {hasLocalAPI ? (
        <>
          <section
            className="rounded-card border border-border bg-card p-5"
            aria-label={t("import")}
          >
            <div className="mb-4 flex gap-2 border-b border-border pb-3">
              <Link
                to={link({ track: "xbond" })}
                className={cn(
                  "rounded-[6px] px-3.5 py-1.5 text-body font-medium no-underline transition-all duration-150 motion-reduce:transition-none",
                  track === "xbond"
                    ? "bg-brand-soft font-semibold text-brand-text"
                    : "text-muted-foreground hover:bg-inset hover:text-foreground",
                )}
                aria-current={track === "xbond" ? "page" : undefined}
              >
                {t("xbondTrack")}
              </Link>
              <Link
                to={link({ track: "universal" })}
                className={cn(
                  "rounded-[6px] px-3.5 py-1.5 text-body font-medium no-underline transition-all duration-150 motion-reduce:transition-none",
                  track === "universal"
                    ? "bg-brand-soft font-semibold text-brand-text"
                    : "text-muted-foreground hover:bg-inset hover:text-foreground",
                )}
                aria-current={track === "universal" ? "page" : undefined}
              >
                {t("universalTrack")}
              </Link>
            </div>

            {track === "xbond" && (
              <p className="mb-3.5 text-xs text-muted-foreground">
                {t("bindNote")}
              </p>
            )}

            <form
              className="grid grid-cols-[2fr_1fr_auto] items-end gap-3 max-md:grid-cols-1"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {track === "xbond" ? t("xbondTrack") : t("universalTrack")}
                </span>
                <Input
                  type={track === "xbond" ? "password" : "text"}
                  value={track === "xbond" ? token : url}
                  onChange={
                    track === "xbond"
                      ? (e) => setToken(e.target.value)
                      : (e) => setUrl(e.target.value)
                  }
                  placeholder={
                    track === "xbond"
                      ? t("tokenPlaceholder")
                      : t("urlPlaceholder")
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t("namePlaceholder")}
                </span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              </label>
              <Button
                type="submit"
                variant="brand"
                className="h-[38px] whitespace-nowrap px-5"
                disabled={pending || !(track === "xbond" ? token : url).trim()}
              >
                {pending
                  ? tc("loading")
                  : track === "universal"
                    ? t("import")
                    : t("addBtn")}
              </Button>
            </form>

            {importFeedback !== "idle" && (
              <div
                className={cn(
                  "mt-3.5 flex items-center rounded-sm border px-3.5 py-2.5 text-body",
                  importFeedback === "success"
                    ? "border-success/25 bg-success/10 text-success-text"
                    : "border-destructive/25 bg-destructive/10 text-destructive-text",
                )}
                role={importFeedback === "failed" ? "alert" : "status"}
              >
                <span>
                  {t(
                    importFeedback === "success" ? "imported" : "importFailed",
                  )}
                  {importError && <span className="block">{importError}</span>}
                </span>
                {importFeedback === "success" && (
                  <Link
                    className="section-link ml-2"
                    to={workspaceLink(location.search, "/connect")}
                  >
                    {sb("home")} &rarr;
                  </Link>
                )}
              </div>
            )}
          </section>

          <RequestStatus error={subError} retry={refreshSubs} />

          <section className="flex flex-col gap-3" aria-label={t("title")}>
            <div className="section-heading items-baseline">
              <h2>{t("title")}</h2>
              <span className="text-xs text-muted-foreground">
                {t("count", { count: subscriptions.length })}
              </span>
            </div>

            {subscriptions.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4 max-sm:grid-cols-1">
                {subscriptions.map((sub) => {
                  const quota = subscriptionQuota(sub);
                  const isActive = sub.id === activeId;
                  return (
                    <article
                      className={cn(
                        "flex flex-col justify-between rounded-card border p-[18px] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
                        isActive
                          ? "border-brand bg-[linear-gradient(180deg,var(--card)_0%,var(--surface-inset)_100%)]"
                          : "border-border hover:border-border-strong hover:shadow-[0_4px_12px_oklch(0_0_0/4%)]",
                      )}
                      key={sub.id}
                    >
                      <div className="mb-3.5 flex items-start justify-between gap-2.5">
                        <div className="flex flex-col gap-1">
                          <h3 className="m-0 text-subtitle font-[650] text-foreground">
                            {sub.name}
                          </h3>
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-[4px] bg-inset px-2 py-0.5 text-label font-medium text-muted-foreground">
                              {sub.type === "xbond"
                                ? t("typeXbond")
                                : t("typeUniversal")}
                            </span>
                            {isActive && (
                              <span className="rounded-[4px] bg-brand px-2 py-0.5 text-label font-semibold text-brand-foreground">
                                {t("active")}
                              </span>
                            )}
                            {sub.sourcePinned && (
                              <span className="rounded-[4px] bg-brand px-2 py-0.5 text-label font-semibold text-warning">
                                {t("sourcePinned")}
                              </span>
                            )}
                          </div>
                        </div>
                        {!isActive && (
                          <Button
                            disabled={pending}
                            onClick={() =>
                              void run(async () => {
                                await selectSub(sub.id);
                                await refresh();
                              })
                            }
                          >
                            {t("use")}
                          </Button>
                        )}
                      </div>

                      <div className="mb-3.5 flex flex-col gap-3.5 border-y border-dashed border-border py-3">
                        {quota ? (
                          <div className="flex items-center gap-4">
                            <QuotaRing percent={quota.remainingPercent} />
                            <div className="flex min-w-0 flex-col gap-1.5">
                              <Stat label={c("quota.remaining")}>
                                {formatTraffic(quota.remaining)}
                              </Stat>
                              <Stat
                                size="sm"
                                label={`${c("used")} / ${c("quota.total")}`}
                              >
                                {formatTraffic(quota.used)} /{" "}
                                {formatTraffic(sub.total)}
                              </Stat>
                            </div>
                          </div>
                        ) : (
                          <p className="my-1.5 text-xs text-muted-foreground">
                            {c("quota.unknown")}
                          </p>
                        )}

                        <dl className="m-0 flex flex-col gap-1 text-label">
                          {sub.expire > 0 && (
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">
                                {c("expiry")}
                              </dt>
                              <dd className="m-0 font-mono tabular-nums text-foreground">
                                {new Date(sub.expire * 1000).toLocaleDateString(
                                  lang.replace("_", "-"),
                                )}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">
                              {t("updated")}
                            </dt>
                            <dd className="m-0 font-mono tabular-nums text-foreground">
                              {sub.lastUpdated
                                ? new Date(
                                    sub.lastUpdated * 1000,
                                  ).toLocaleString(lang.replace("_", "-"))
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              await updateSub(sub.id);
                              await refresh();
                            })
                          }
                        >
                          {t("updateBtn")}
                        </Button>
                        <ButtonSelect
                          value={sub.updateChannel || "direct"}
                          disabled={pending}
                          options={[
                            { label: t("channelDirect"), value: "direct" },
                            { label: t("channelSelf"), value: "self" },
                            { label: t("channelProxy"), value: "proxy" },
                          ]}
                          onSelect={(channel) =>
                            selectChannel(
                              sub.id,
                              channel as "direct" | "self" | "proxy",
                            )
                          }
                        />
                        <Button
                          disabled={pending}
                          onClick={() => rollback(sub.id)}
                        >
                          {t("rollback")}
                        </Button>
                        {sub.sourcePinned && (
                          <Button
                            variant="warning"
                            disabled={pending}
                            onClick={() => resumeUpdates(sub.id)}
                          >
                            {t("resumeUpdates")}
                          </Button>
                        )}
                        {sub.urlOrFile &&
                          /^https?:\/\//i.test(sub.urlOrFile) && (
                            <CopyButton
                              value={sub.urlOrFile}
                              label={c("copyLink")}
                            />
                          )}
                        <Button
                          disabled={pending}
                          onClick={() => {
                            setRenameId(sub.id);
                            setRenameValue(sub.name);
                          }}
                        >
                          {t("rename")}
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => void openOverride(sub.id)}
                        >
                          {t("override")}
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => void openSourceEditor(sub.id)}
                        >
                          {t("sourceEdit")}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={pending}
                          onClick={() => setRemoveId(sub.id)}
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <p>{t("noSubs")}</p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="p-8 text-center text-muted-foreground">
          <p>{t("readonly")}</p>
        </section>
      )}

      <Dialog
        open={renameId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRenameId(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
          </DialogHeader>
          <label>
            {t("namePlaceholder")}
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setRenameId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={
                pending ||
                !renameValue.trim() ||
                Array.from(renameValue).length > 256
              }
              onClick={() => {
                if (
                  !renameId ||
                  !renameValue.trim() ||
                  Array.from(renameValue).length > 256
                )
                  return;
                void run(async () => {
                  await renameSub(renameId, renameValue.trim());
                  await refresh();
                  setRenameId(null);
                });
              }}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoveId(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("remove")}</DialogTitle>
          </DialogHeader>
          <div>
            <p>{t("removeConfirm")}</p>
            {removeId === activeId && status?.engine.running && (
              <p className="mt-2 text-destructive">{t("removeActive")}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setRemoveId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  if (
                    removeId === activeId &&
                    status?.engine.running &&
                    localClient
                  )
                    await localClient.down();
                  if (removeId) await removeSub(removeId);
                  await refresh();
                  setRemoveId(null);
                }, false)
              }
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditorId(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("sourceEdit")}</DialogTitle>
          </DialogHeader>
          <div className="[&_textarea]:min-h-80">
            <div className="setting-label-col flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                {t("sourceEditHint")}
              </p>
              <textarea
                className="w-full resize-y rounded-sm border border-border bg-inset px-3 py-2.5 font-mono text-body leading-normal text-foreground"
                rows={16}
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                spellCheck={false}
              />
              {editorError && (
                <p role="alert" className="text-sm text-destructive">
                  {editorError}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setEditorId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button disabled={pending} onClick={() => saveSourceEditor()}>
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={proxyChannelId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setProxyChannelId(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("channelProxy")}</DialogTitle>
          </DialogHeader>
          <div>
            <label>
              {t("channelProxyUrl")}
              <Input
                value={proxyChannelUrl}
                onChange={(e) => setProxyChannelUrl(e.target.value)}
                placeholder="http://127.0.0.1:7890"
              />
            </label>
            <p className="mt-2 text-muted-foreground">
              {t("channelProxyNote")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setProxyChannelId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || !proxyChannelUrl.trim()}
              onClick={() => saveProxyChannel()}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={overrideId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setOverrideId(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("override")}</DialogTitle>
          </DialogHeader>
          <div className="setting-label-col flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {t(
                subscriptions.find((sub) => sub.id === overrideId)?.format ===
                  "sing-box"
                  ? "overrideHintSingBox"
                  : "overrideHintClash",
              )}
            </p>
            <label>
              {t("overridePrepend")}
              <textarea
                className="w-full resize-y rounded-sm border border-border bg-inset px-3 py-2.5 font-mono text-body leading-normal text-foreground"
                rows={4}
                value={overridePrepend}
                onChange={(event) => setOverridePrepend(event.target.value)}
                placeholder={"DOMAIN-SUFFIX,corp.example,DIRECT"}
              />
            </label>
            <label>
              {t("overrideAppend")}
              <textarea
                className="w-full resize-y rounded-sm border border-border bg-inset px-3 py-2.5 font-mono text-body leading-normal text-foreground"
                rows={4}
                value={overrideAppend}
                onChange={(event) => setOverrideAppend(event.target.value)}
                placeholder={"DOMAIN-SUFFIX,ads.example,REJECT"}
              />
            </label>
            <label>
              {t("overrideDns")}
              <textarea
                className="w-full resize-y rounded-sm border border-border bg-inset px-3 py-2.5 font-mono text-body leading-normal text-foreground"
                rows={4}
                value={overrideDns}
                onChange={(event) => setOverrideDns(event.target.value)}
                placeholder={
                  subscriptions.find((sub) => sub.id === overrideId)?.format ===
                  "sing-box"
                    ? '{\n  "servers": [{ "tag": "dns-local", "address": "8.8.8.8" }]\n}'
                    : "nameserver:\n  - 8.8.8.8"
                }
              />
            </label>
            {overrideError && (
              <p role="alert" className="text-sm text-destructive">
                {overrideError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setOverrideId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button disabled={pending} onClick={() => void saveOverride()}>
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
