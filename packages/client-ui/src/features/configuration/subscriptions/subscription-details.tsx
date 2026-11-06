import { formatTraffic } from "@xbond/client/helper";
import {
  isAccountManaged,
  subscriptionQuota,
  subscriptionQuotaStatus,
} from "@xbond/client/localapi";
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  FileText,
  Globe,
  Pencil,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { QuotaRing } from "@/components/quota-ring";
import { RequestStatus } from "@/components/request-status";
import { SegmentedControl } from "@/components/segmented-control";
import { Stat } from "@/components/stat";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { useLocalAPI } from "@/state/local-runtime";
import { useLanguage } from "@/state/user-preferences";

import { useAccount } from "../account/use-cloud-account";
import { ResourceIcon } from "../configuration-resource-icon";
import UpdateFrequency from "./update-frequency-field";
import { useSubscriptions } from "./use-subscriptions";

export default function SubscriptionDetail({
  selectedId,
}: {
  selectedId: string;
}) {
  const { lang } = useLanguage();
  const { resync } = useAccount();
  const { t } = useTranslation("subscriptions");
  const { t: cfg } = useTranslation("configuration");
  const { t: tc } = useTranslation("common");
  const { t: c } = useTranslation("connect");
  const { status, refresh, client: localClient, isLocalTarget } = useLocalAPI();
  const {
    subscriptions,
    activeId,
    operation,
    selectSub,
    updateSub,
    removeSub,
    renameSub,
    error: subError,
    refresh: refreshSubs,
  } = useSubscriptions();

  const { run, pending } = useAction();
  const [removeId, setRemoveId] = useState<string | null>(null);
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
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
  const [sourceURL, setSourceURL] = useState<string | null>(null);

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
      setOverrideError(error instanceof Error ? error.message : String(error));
    }
  }

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
    }, t("channelDone"));
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
    }, t("channelDone"));
  }

  function rollback(id: string) {
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      await localClient.rollbackSub(id);
      await refresh();
      toast.success(t("rollbackDone"));
    }, false);
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

  const sub = subscriptions.find((item) => item.id === selectedId);

  if (!sub) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>{t("noSubs")}</p>
      </div>
    );
  }

  const quota = subscriptionQuota(sub);
  const quotaStatus = subscriptionQuotaStatus(sub);
  const isActive = isLocalTarget && sub.id === activeId;
  // daemon 端 loadStore 保證 kind 回填，前端不再用 URL 正則猜測載體。
  const isRemote = sub.kind === "remote";
  const isLocal = sub.kind === "local";
  const isInline = sub.kind === "inline";
  const isCloud = sub.kind === "cloud";

  return (
    <div className="flex flex-col w-full gap-6">
      <RequestStatus error={subError} retry={refreshSubs} />

      {/* 1. Header Banner & Identity */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <ResourceIcon
            kind={sub.format || "local"}
            className="size-12 shrink-0 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {sub.name}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={t("rename")}
                onClick={() => {
                  setRenameId(sub.id);
                  setRenameValue(sub.name);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                {sub.format || "config"}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {isCloud
                  ? cfg("kindCloud")
                  : isInline
                    ? cfg("kindInline")
                    : isLocal
                      ? cfg("kindLocal")
                      : cfg("kindRemote")}
              </span>
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">
                  <Check className="size-3" />
                  {cfg("activeLocal")}
                </span>
              )}
              {sub.sourcePinned && (
                <span className="rounded-md bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-text">
                  {t("sourcePinned")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {(isRemote || isLocal) && (
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              className="gap-2"
              onClick={() =>
                void run(async () => {
                  if (isAccountManaged(sub)) {
                    const result = await resync();
                    if (result.updateError) throw new Error(result.updateError);
                  } else {
                    await updateSub(sub.id);
                  }
                  await refresh();
                  await refreshSubs();
                }, t("updateDone"))
              }
            >
              <RefreshCw
                className={cn(
                  "size-4",
                  (pending || operation) && "animate-spin",
                )}
              />
              {isLocal ? cfg("reloadFile") : t("updateBtn")}
            </Button>
          )}

          {isActive ? (
            <Button
              variant="secondary"
              disabled
              className="pointer-events-none gap-1.5"
            >
              <Check className="size-4 text-success" />
              {cfg("activeLocal")}
            </Button>
          ) : (
            <Button
              variant="brand"
              className="gap-1.5"
              disabled={pending || Boolean(operation)}
              onClick={() =>
                void run(async () => {
                  await selectSub(sub.id);
                  await refresh();
                  await refreshSubs();
                }, t("activateDone"))
              }
            >
              <Zap className="size-4" />
              {cfg("use")}
            </Button>
          )}
        </div>
      </div>

      {/* Health alert if sync or core check failed */}
      {sub.health && sub.health !== "ok" && (
        <div
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-destructive">
              {cfg(
                sub.lastHash || sub.lastUpdated
                  ? "updateFailed"
                  : "noCachedConfig",
              )}
            </div>
            {sub.lastErrorMessage && (
              <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                {sub.lastErrorMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Source pinned notice (user edited raw config locally) */}
      {sub.sourcePinned && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2.5 text-sm">
            <AlertCircle className="size-4 shrink-0 text-warning-text" />
            <span className="text-warning-text">{t("sourceEditHint")}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            disabled={pending || Boolean(operation)}
            onClick={() => resumeUpdates(sub.id)}
          >
            <RefreshCw className="size-3.5" />
            {t("resumeUpdates")}
          </Button>
        </div>
      )}

      {/* 2. Quota & Traffic Usage Card */}
      <div className="rounded-card border bg-card p-5 shadow-elevation-card">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          {c("quota.title")}
        </h3>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-5 xl:grid-cols-[auto_minmax(10rem,1fr)_auto] xl:items-center">
          {quota ? (
            <>
              <QuotaRing percent={quota.remainingPercent} />
              <div className="flex min-w-0 flex-col gap-2">
                <Stat label={c("quota.remaining")} className="tabular-nums">
                  {formatTraffic(quota.remaining)}
                </Stat>
                <Stat
                  size="sm"
                  label={`${c("used")} / ${c("quota.total")}`}
                  className="tabular-nums"
                >
                  {formatTraffic(quota.used)} / {formatTraffic(sub.total)}
                </Stat>
                {quota.remaining <= 0 && (
                  <span className="text-xs font-medium text-warning-text">
                    {c("quota.exhausted")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {c("quota.source")}: {c("quota.sourceSubscription")}
                </span>
              </div>
            </>
          ) : (
            <div className="col-span-2 text-xs text-muted-foreground">
              <p>
                {quotaStatus === "noTotal"
                  ? c("quota.noTotal")
                  : c("quota.unknown")}
              </p>
              <p className="mt-1">
                {quotaStatus === "noTotal"
                  ? c("quota.noTotalDesc")
                  : c("quota.unknownDesc")}
              </p>
            </div>
          )}

          <div className="col-span-full flex min-w-0 flex-col gap-2.5 border-t border-border pt-4 text-xs xl:col-span-1 xl:border-t-0 xl:border-s xl:pt-0 xl:ps-6">
            {sub.expire > 0 && (
              <div className="flex items-center justify-between gap-3 xl:justify-start">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="size-3.5" />
                  {c("expiry")}
                </span>
                <span className="font-mono font-medium text-foreground tabular-nums">
                  {new Date(sub.expire * 1000).toLocaleDateString(
                    lang.replace("_", "-"),
                  )}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 xl:justify-start">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-3.5" />
                {t("updated")}
              </span>
              <span className="font-mono font-medium text-foreground tabular-nums">
                {sub.lastUpdated
                  ? new Date(sub.lastUpdated * 1000).toLocaleString(
                      lang.replace("_", "-"),
                    )
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Subscription Source & Sync Card */}
      <div className="flex flex-col rounded-card border bg-card p-5 shadow-elevation-card gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {isRemote
            ? cfg("sourceLink")
            : isLocal
              ? cfg("sourceLocal")
              : cfg("kindInline")}
        </h3>

        {isRemote && (
          <>
            {/* URL Display with Copy and Edit buttons */}
            <div className="flex items-center gap-2 rounded-control border border-border/80 bg-inset px-3 py-2">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 select-all truncate font-mono text-xs text-foreground">
                {sub.urlOrFile || "—"}
              </span>
              {sub.urlOrFile && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <CopyButton value={sub.urlOrFile} label={c("copyLink")} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => setSourceURL(sub.urlOrFile || "")}
                  >
                    <Pencil className="size-3.5" />
                    {cfg("edit")}
                  </Button>
                </div>
              )}
            </div>

            {/* Sync Frequency */}
            {sub.type === "universal" && (
              <div className="border-t border-border/60 pt-3">
                <UpdateFrequency
                  inline
                  value={sub.autoUpdate ? sub.updateIntervalHours : 0}
                  disabled={pending || Boolean(operation) || !localClient}
                  onChange={(hours) =>
                    void run(async () => {
                      if (!localClient)
                        throw new Error("LocalAPI not available");
                      await localClient.setSubUpdateSchedule(sub.id, hours);
                      await refreshSubs();
                      await refresh();
                    })
                  }
                />
              </div>
            )}

            {/* Update Channel Selector */}
            <div className="flex flex-col gap-2 border-t border-border/60 pt-3 text-xs xl:flex-row xl:items-center xl:justify-between">
              <span className="text-muted-foreground">{t("channelTitle")}</span>
              <SegmentedControl<"direct" | "self" | "proxy">
                ariaLabel={t("channelTitle")}
                value={sub.updateChannel || "direct"}
                disabled={pending || Boolean(operation)}
                options={[
                  { label: t("channelDirect"), value: "direct" },
                  { label: t("channelSelf"), value: "self" },
                  { label: t("channelProxy"), value: "proxy" },
                ]}
                onChange={(channel) => selectChannel(sub.id, channel)}
              />
            </div>
          </>
        )}

        {isLocal && (
          <div className="flex items-center gap-2 rounded-control border border-border bg-inset px-3 py-2">
            <span className="flex-1 select-all truncate font-mono text-xs text-foreground">
              {sub.urlOrFile || "—"}
            </span>
          </div>
        )}

        {isInline && (
          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <span className="text-xs text-muted-foreground">
              {t("sourceEditHint")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={pending || Boolean(operation)}
              onClick={() => void openSourceEditor(sub.id)}
            >
              <FileText className="size-3.5" />
              {cfg("editContent")}
            </Button>
          </div>
        )}
      </div>

      {/* 4. Advanced Config & Rules Card */}
      <div className="flex flex-col rounded-card border bg-card p-5 shadow-elevation-card gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("advancedSettings")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("advancedDesc")}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
          {/* Source Editor */}
          <div className="flex flex-col justify-between rounded-xl bg-inset/60 p-4 transition-colors hover:bg-inset">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-2xs">
                  <FileText className="size-3.5" />
                </div>
                {t("sourceEdit")}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                {t("sourceEditDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full bg-card hover:bg-accent"
              disabled={pending || Boolean(operation)}
              onClick={() => void openSourceEditor(sub.id)}
            >
              {t("sourceEdit")}
            </Button>
          </div>

          {/* Rule Override */}
          <div className="flex flex-col justify-between rounded-xl bg-inset/60 p-4 transition-colors hover:bg-inset">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-2xs">
                  <SlidersHorizontal className="size-3.5" />
                </div>
                {t("override")}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                {t("overrideDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full bg-card hover:bg-accent"
              disabled={pending || Boolean(operation)}
              onClick={() => void openOverride(sub.id)}
            >
              {t("override")}
            </Button>
          </div>

          {/* Rollback */}
          <div className="flex flex-col justify-between rounded-xl bg-inset/60 p-4 transition-colors hover:bg-inset">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-2xs">
                  <RotateCcw className="size-3.5" />
                </div>
                {t("rollback")}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                {t("rollbackDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full bg-card hover:bg-accent"
              disabled={pending || Boolean(operation)}
              onClick={() => rollback(sub.id)}
            >
              {t("rollback")}
            </Button>
          </div>
        </div>
      </div>

      {/* 5. Danger Zone */}
      <div className="rounded-card border border-destructive/25 bg-destructive/[0.03] p-5 shadow-elevation-card flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <Trash2 className="size-4" />
            {t("dangerZone")}
          </h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            {t("removeDesc")}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="shrink-0"
          disabled={pending || Boolean(operation)}
          ref={removeTrigger}
          onClick={() => setRemoveId(sub.id)}
        >
          {t("remove")}
        </Button>
      </div>

      {/* Dialog: Edit Subscription URL */}
      <Dialog
        open={sourceURL !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setSourceURL(null);
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{cfg("editLink")}</DialogTitle>
          </DialogHeader>
          <Field className="gap-2">
            <FieldLabel htmlFor="subscription-edit-link">
              {cfg("sourceLink")}
            </FieldLabel>
            <Input
              id="subscription-edit-link"
              type="url"
              value={sourceURL || ""}
              onChange={(event) => setSourceURL(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              onClick={() => setSourceURL(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || Boolean(operation) || !sourceURL?.trim()}
              onClick={() =>
                void run(async () => {
                  if (!localClient || !sourceURL)
                    throw new Error("LocalAPI not available");
                  await localClient.changeSubURL(selectedId, sourceURL.trim());
                  await refreshSubs();
                  setSourceURL(null);
                })
              }
            >
              {cfg("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Rename Profile */}
      <Dialog
        open={renameId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRenameId(null);
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
          </DialogHeader>
          <Field className="gap-2">
            <FieldLabel htmlFor="subscription-rename">
              {t("namePlaceholder")}
            </FieldLabel>
            <Input
              id="subscription-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
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

      {/* Dialog: Remove Profile Confirmation */}
      <AlertDialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoveId(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (removeTrigger.current?.isConnected) {
              event.preventDefault();
              removeTrigger.current.focus();
            }
          }}
          className="data-[size=default]:sm:max-w-[420px]"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>{t("removeConfirm")}</p>
              {removeId === activeId && status?.engine.running && (
                <p className="font-medium text-destructive">
                  {t("removeActive")}
                </p>
              )}
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending || Boolean(operation)}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || Boolean(operation)}
              onClick={(event) => {
                event.preventDefault();
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
                }, false);
              }}
            >
              {tc("ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: Source Editor (Full screen / Wide dialog) */}
      <Dialog
        open={editorId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditorId(null);
        }}
      >
        <DialogContent
          closeLabel={tc("close")}
          className="sm:max-w-3xl max-h-[90vh] flex flex-col"
        >
          <DialogHeader>
            <DialogTitle>{t("sourceEdit")}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <p className="text-xs text-muted-foreground">
              {t("sourceEditHint")}
            </p>
            <Textarea
              className="flex-1 min-h-[420px] max-h-[60vh] resize-y p-3 font-mono text-xs leading-relaxed"
              value={editorContent}
              onChange={(event) => setEditorContent(event.target.value)}
              spellCheck={false}
            />
            {editorError && (
              <p role="alert" className="text-xs text-destructive">
                {editorError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              onClick={() => setEditorId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || Boolean(operation)}
              onClick={() => saveSourceEditor()}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Proxy Channel Config */}
      <Dialog
        open={proxyChannelId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setProxyChannelId(null);
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("channelProxy")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field className="gap-2">
              <FieldLabel htmlFor="subscription-proxy-url">
                {t("channelProxyUrl")}
              </FieldLabel>
              <Input
                id="subscription-proxy-url"
                value={proxyChannelUrl}
                onChange={(e) => setProxyChannelUrl(e.target.value)}
                placeholder="http://127.0.0.1:7890"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t("channelProxyNote")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              onClick={() => setProxyChannelId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={
                pending || Boolean(operation) || !proxyChannelUrl.trim()
              }
              onClick={() => saveProxyChannel()}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Override Rules & DNS */}
      <Dialog
        open={overrideId !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setOverrideId(null);
        }}
      >
        <DialogContent
          closeLabel={tc("close")}
          className="sm:max-w-2xl max-h-[90vh] flex flex-col"
        >
          <DialogHeader>
            <DialogTitle>{t("override")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col flex-1 overflow-y-auto gap-4 py-1 pr-1 text-xs">
            <p className="text-muted-foreground">
              {t(
                subscriptions.find((item) => item.id === overrideId)?.format ===
                  "sing-box"
                  ? "overrideHintSingBox"
                  : "overrideHintClash",
              )}
            </p>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="subscription-override-prepend">
                {t("overridePrepend")}
              </FieldLabel>
              <Textarea
                id="subscription-override-prepend"
                className="resize-y p-2.5 font-mono text-xs leading-normal"
                rows={3}
                value={overridePrepend}
                onChange={(event) => setOverridePrepend(event.target.value)}
                placeholder={"DOMAIN-SUFFIX,corp.example,DIRECT"}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="subscription-override-append">
                {t("overrideAppend")}
              </FieldLabel>
              <Textarea
                id="subscription-override-append"
                className="resize-y p-2.5 font-mono text-xs leading-normal"
                rows={3}
                value={overrideAppend}
                onChange={(event) => setOverrideAppend(event.target.value)}
                placeholder={"DOMAIN-SUFFIX,ads.example,REJECT"}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="subscription-override-dns">
                {t("overrideDns")}
              </FieldLabel>
              <Textarea
                id="subscription-override-dns"
                className="resize-y p-2.5 font-mono text-xs leading-normal"
                rows={3}
                value={overrideDns}
                onChange={(event) => setOverrideDns(event.target.value)}
                placeholder={
                  subscriptions.find((item) => item.id === overrideId)
                    ?.format === "sing-box"
                    ? '{\n  "servers": [{ "tag": "dns-local", "address": "8.8.8.8" }]\n}'
                    : "nameserver:\n  - 8.8.8.8"
                }
              />
            </Field>
            {overrideError && (
              <p role="alert" className="text-destructive">
                {overrideError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              onClick={() => setOverrideId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending || Boolean(operation)}
              onClick={() => void saveOverride()}
            >
              {tc("ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
