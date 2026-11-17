import type { EditorView } from "@codemirror/view";
import { formatTraffic } from "@xbond/client/helper";
import {
  isAccountManaged,
  subscriptionQuota,
  subscriptionQuotaStatus,
  type RuleGroup,
} from "@xbond/client/localapi";
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  FileText,
  Globe,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CopyIconButton } from "@/components/copy-button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { useLocalAPI } from "@/state/local-runtime";
import { useLanguage } from "@/state/user-preferences";

import { useAccount } from "../account/use-cloud-account";
import { ResourceIcon } from "../configuration-resource-icon";
import UpdateFrequency from "./update-frequency-field";
import { useSubscriptions } from "./use-subscriptions";

/** One-tap DNS upstream presets; keys stay literal for typed i18n lookups. */
type DnsPresetKey = "dnsPresetAli" | "dnsPresetTencent" | "dnsPresetGlobal";

const dnsPresets: readonly {
  key: DnsPresetKey;
  values: readonly string[];
}[] = [
  { key: "dnsPresetAli", values: ["223.5.5.5", "223.6.6.6"] },
  { key: "dnsPresetTencent", values: ["119.29.29.29"] },
];

const dnsFallbackPresets: readonly {
  key: DnsPresetKey;
  values: readonly string[];
}[] = [{ key: "dnsPresetGlobal", values: ["1.1.1.1", "8.8.8.8"] }];

// 原文编辑器懒加载：CodeMirror 及语言包只进独立分块，首次打开才加载。
const CodeEditor = lazy(() => import("@/components/code-editor"));

/** One editable DNS upstream list: address rows, an add row and presets. */
function UpstreamList({
  values,
  onChange,
  presets,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  presets?: readonly { key: DnsPresetKey; values: readonly string[] }[];
}) {
  const { t } = useTranslation("subscriptions");
  return (
    <div className="flex flex-col gap-1.5">
      {values.map((upstream, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="h-8 min-w-0 flex-1 font-mono text-xs"
            placeholder={t("dnsUpstreamPlaceholder")}
            value={upstream}
            onChange={(event) =>
              onChange(
                values.map((value, i) =>
                  i === index ? event.target.value : value,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={t("removeDnsUpstream")}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-fit gap-1 text-caption"
          onClick={() => onChange([...values, ""])}
        >
          <Plus className="size-3" />
          {t("addDnsUpstream")}
        </Button>
        {presets?.map((preset) => (
          <Button
            key={preset.key}
            variant="ghost"
            size="sm"
            className="h-7 w-fit text-caption text-muted-foreground"
            onClick={() =>
              onChange([
                ...values.filter((value) => value.trim().length > 0),
                ...preset.values,
              ])
            }
          >
            + {t(preset.key)}
          </Button>
        ))}
      </div>
    </div>
  );
}

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
  // 取回原文/覆盖配置的进行中请求：加载中再点一次入口按钮即取消，
  // 15s 无响应按超时报错，不让慢网络把入口按钮变成死等。
  const editorAbort = useRef<AbortController | null>(null);
  const overrideAbort = useRef<AbortController | null>(null);
  const loadTimeoutMs = 15000;
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideGroups, setOverrideGroups] = useState<RuleGroup[]>([]);
  const [dnsNameservers, setDnsNameservers] = useState<string[]>([]);
  const [dnsFallback, setDnsFallback] = useState<string[]>([]);
  const [overridePolicies, setOverridePolicies] = useState<string[]>([]);
  const [policiesUnavailable, setPoliciesUnavailable] = useState(false);
  const [overrideFormat, setOverrideFormat] = useState<
    "" | "clash" | "sing-box"
  >("");
  const [overrideError, setOverrideError] = useState("");
  const [proxyChannelId, setProxyChannelId] = useState<string | null>(null);
  const [proxyChannelUrl, setProxyChannelUrl] = useState("");
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorError, setEditorError] = useState("");
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  // 非受控编辑器的取全文入口：保存时读视图文档，按键不搬运字符串。
  const editorViewRef = useRef<EditorView | null>(null);
  const [sourceURL, setSourceURL] = useState<string | null>(null);

  const maxRuleGroups = 10;
  const maxRulesPerGroup = 50;
  const maxCustomRules = 100;

  function ruleKind(value: string): "" | "domain" | "ip" | "cidr" {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.includes("/")) return "cidr";
    if (trimmed.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed))
      return "ip";
    return "domain";
  }

  // 取回内容后才开框：目标可能是远端控制器，慢网络下不能停在空对话框上。
  function openOverride(id: string) {
    if (overrideLoading) {
      overrideAbort.current?.abort();
      return;
    }
    const controller = new AbortController();
    overrideAbort.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Timed out", "TimeoutError"));
    }, loadTimeoutMs);
    setOverrideLoading(true);
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      setOverrideError("");
      setOverrideGroups([]);
      setDnsNameservers([]);
      setDnsFallback([]);
      setOverridePolicies([]);
      setOverrideFormat(
        subscriptions.find((item) => item.id === id)?.format === "sing-box"
          ? "sing-box"
          : "",
      );
      setPoliciesUnavailable(false);
      try {
        const [current, available] = await Promise.all([
          localClient.getSubOverride(id, { signal: controller.signal }),
          localClient
            .getSubPolicies(id, { signal: controller.signal })
            .catch(() => undefined),
        ]);
        setOverrideGroups(
          (current.groups ?? []).map((group) => ({
            ...group,
            enabled: group.enabled !== false,
          })),
        );
        setDnsNameservers(current.dns?.nameservers ?? []);
        setDnsFallback(current.dns?.fallback ?? []);
        if (available) {
          setOverridePolicies(available.policies);
          setOverrideFormat(
            available.format === "sing-box" ? "sing-box" : "clash",
          );
        } else {
          setPoliciesUnavailable(true);
        }
        setOverrideId(id);
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return; // 用户取消
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }, false).finally(() => setOverrideLoading(false));
  }

  async function saveOverride() {
    if (!overrideId || !localClient) return;
    setOverrideError("");
    for (const [index, group] of overrideGroups.entries()) {
      const filled = group.rules.some((rule) => rule.trim().length > 0);
      if (group.enabled && filled && !group.target) {
        setOverrideError(t("ruleTargetRequired", { number: index + 1 }));
        return;
      }
    }
    // 备用列表只对 Clash 订阅开放；sing-box 没有这个机制，发出去会被拒。
    const isClash = overrideFormat === "clash";
    const nameservers = dnsNameservers
      .map((upstream) => upstream.trim())
      .filter(Boolean);
    const fallback = isClash
      ? dnsFallback.map((upstream) => upstream.trim()).filter(Boolean)
      : [];
    try {
      await localClient.setSubOverride(overrideId, {
        groups: overrideGroups.map((group, index) => ({
          ...group,
          name: group.name.trim() || t("ruleGroupName", { number: index + 1 }),
          rules: group.rules.map((rule) => rule.trim()).filter(Boolean),
        })),
        dns:
          nameservers.length > 0 || fallback.length > 0
            ? { nameservers, fallback }
            : undefined,
      });
      await refresh();
      setOverrideId(null);
      toast.success(t("overrideSaved"));
    } catch (error) {
      setOverrideError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateGroup(index: number, patch: Partial<RuleGroup>) {
    setOverrideGroups((groups) =>
      groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
  }

  function updateGroupRules(
    index: number,
    update: (rules: string[]) => string[],
  ) {
    setOverrideGroups((groups) =>
      groups.map((group, i) =>
        i === index ? { ...group, rules: update(group.rules) } : group,
      ),
    );
  }

  const customRuleTotal = overrideGroups.reduce(
    (sum, group) => sum + group.rules.filter((rule) => rule.trim()).length,
    0,
  );
  // Built-ins stay offered even before the policy list loads (or when the
  // profile has no downloaded source yet): they never depend on the source.
  const targetOptions = Array.from(
    new Set([
      ...overridePolicies.filter(
        (target) => !["DIRECT", "REJECT"].includes(target.toUpperCase()),
      ),
      ...overrideGroups.map((group) => group.target).filter(Boolean),
      "DIRECT",
      "REJECT",
    ]),
  );

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

  // 取回原文后才开框：慢网络下不能停在空编辑器上。
  function openSourceEditor(id: string) {
    if (editorLoading) {
      editorAbort.current?.abort();
      return;
    }
    const controller = new AbortController();
    editorAbort.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Timed out", "TimeoutError"));
    }, loadTimeoutMs);
    setEditorLoading(true);
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      try {
        const content = await localClient.getSubSource(id, {
          signal: controller.signal,
        });
        setEditorContent(content);
        setEditorError("");
        setEditorId(id);
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return; // 用户取消
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }, false).finally(() => setEditorLoading(false));
  }

  function saveSourceEditor() {
    if (!editorId || !localClient) return;
    // 编辑器是非受控实例：保存时从视图读全文，避免每次按键搬运整个文档。
    const content =
      editorViewRef.current?.state.doc.toString() ?? editorContent;
    void run(async () => {
      try {
        await localClient.editSubSource(editorId, content);
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
      <div className="flex flex-col gap-3.5">
        <div className="flex items-start gap-3.5">
          <ResourceIcon
            kind={sub.format || "local"}
            className="size-12 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-title font-semibold tracking-tight text-foreground">
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
              <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                {sub.format || "config"}
              </span>
              <span className="rounded-md bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {isCloud
                  ? cfg("kindCloud")
                  : isInline
                    ? cfg("kindInline")
                    : isLocal
                      ? cfg("kindLocal")
                      : cfg("kindRemote")}
              </span>
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-card px-2.5 py-0.5 text-xs font-semibold text-brand-text">
                  <Check className="size-3" strokeWidth={2.2} />
                  {cfg("activeLocal")}
                </span>
              )}
              {sub.sourcePinned && (
                <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-text">
                  {t("sourcePinned")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {(isRemote || isLocal) && (
            <Button
              variant="outline"
              disabled={pending || Boolean(operation)}
              className="h-9 gap-2 rounded-control bg-card/90 px-3.5 shadow-2xs"
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
                  "size-3.5",
                  (pending || operation) && "animate-spin",
                )}
              />
              {isLocal ? cfg("reloadFile") : t("updateBtn")}
            </Button>
          )}

          {!isActive && (
            <Button
              variant="brand"
              className="h-9 gap-1.5 rounded-control px-4 shadow-xs cursor-pointer"
              disabled={pending || Boolean(operation)}
              onClick={() =>
                void run(async () => {
                  await selectSub(sub.id);
                  await refresh();
                  await refreshSubs();
                }, t("activateDone"))
              }
            >
              <Zap className="size-3.5" />
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
                  <CopyIconButton value={sub.urlOrFile} label={c("copyLink")} />
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
            {(sub.type === "universal" || isRemote) && (
              <div className="border-t border-border/60 pt-3">
                <UpdateFrequency
                  inline
                  value={sub.autoUpdate ? sub.updateIntervalHours || 24 : 0}
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
                size="sm"
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
              disabled={Boolean(operation) || (pending && !editorLoading)}
              title={editorLoading ? tc("cancel") : undefined}
              onClick={() => void openSourceEditor(sub.id)}
            >
              {editorLoading ? (
                <LoaderCircle
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <FileText className="size-3.5" />
              )}
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
          <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-inset/40 p-3.5 transition-[border-color,background-color] duration-150 hover:border-border/80 hover:bg-inset/70">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-2xs">
                  <FileText className="size-3.5" />
                </div>
                <span>{t("sourceEdit")}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("sourceEditDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3.5 w-full bg-card hover:bg-accent text-xs cursor-pointer shadow-2xs"
              disabled={Boolean(operation) || (pending && !editorLoading)}
              title={editorLoading ? tc("cancel") : undefined}
              onClick={() => void openSourceEditor(sub.id)}
            >
              {editorLoading && (
                <LoaderCircle
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {t("sourceEdit")}
            </Button>
          </div>

          {/* Rule Override */}
          <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-inset/40 p-3.5 transition-[border-color,background-color] duration-150 hover:border-border/80 hover:bg-inset/70">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-2xs">
                  <SlidersHorizontal className="size-3.5" />
                </div>
                <span>{t("override")}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("overrideDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3.5 w-full bg-card hover:bg-accent text-xs cursor-pointer shadow-2xs"
              disabled={Boolean(operation) || (pending && !overrideLoading)}
              title={overrideLoading ? tc("cancel") : undefined}
              onClick={() => void openOverride(sub.id)}
            >
              {overrideLoading && (
                <LoaderCircle
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {t("override")}
            </Button>
          </div>

          {/* Rollback */}
          <div className="flex flex-col justify-between rounded-xl border border-border/50 bg-inset/40 p-3.5 transition-[border-color,background-color] duration-150 hover:border-border/80 hover:bg-inset/70">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground shadow-2xs">
                  <RotateCcw className="size-3.5" />
                </div>
                <span>{t("rollback")}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("rollbackDesc")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3.5 w-full bg-card hover:bg-accent text-xs cursor-pointer shadow-2xs"
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
            <Suspense
              fallback={
                <div className="flex min-h-[420px] items-center justify-center rounded-control border border-[var(--glass-border)] bg-inset/60">
                  <Spinner className="size-6 text-brand-strong" />
                </div>
              }
            >
              <CodeEditor
                value={editorContent}
                onViewReady={(view) => {
                  editorViewRef.current = view;
                }}
                ariaLabel={t("sourceEdit")}
                className="h-[60vh] min-h-[420px]"
              />
            </Suspense>
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
            <p className="text-muted-foreground">{t("overrideHint")}</p>

            {/* 出口清單拿不到時如實說明，不讓「只有 DIRECT」假裝成全部 */}
            {policiesUnavailable && (
              <p
                role="note"
                className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-caption text-warning-text"
              >
                {t("ruleTargetsUnavailable")}
              </p>
            )}

            {/* 規則組：同組共用出口、可整組啟停，展開順序即優先順序 */}
            <div className="flex flex-col gap-2">
              {overrideGroups.map((group, groupIndex) => {
                const groupFull = group.rules.length >= maxRulesPerGroup;
                return (
                  <div
                    key={groupIndex}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border border-border/70 bg-inset/40 p-3",
                      !group.enabled && "opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={t("ruleGroupName", {
                          number: groupIndex + 1,
                        })}
                        className="h-8 min-w-0 flex-1"
                        placeholder={t("ruleGroupName", {
                          number: groupIndex + 1,
                        })}
                        value={group.name}
                        onChange={(event) =>
                          updateGroup(groupIndex, { name: event.target.value })
                        }
                      />
                      <Select
                        value={group.target}
                        onValueChange={(value) =>
                          updateGroup(groupIndex, { target: value })
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-8 w-40"
                          aria-label={t("ruleTarget")}
                        >
                          <SelectValue placeholder={t("ruleTarget")} />
                        </SelectTrigger>
                        <SelectContent>
                          {targetOptions.map((target) => (
                            <SelectItem key={target} value={target}>
                              {target}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Switch
                        checked={group.enabled}
                        aria-label={t("ruleGroupEnabled")}
                        onCheckedChange={(enabled) =>
                          updateGroup(groupIndex, { enabled })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={t("removeRuleGroup")}
                        onClick={() =>
                          setOverrideGroups((groups) =>
                            groups.filter((_, i) => i !== groupIndex),
                          )
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {group.rules.map((rule, ruleIndex) => {
                        const kind = ruleKind(rule);
                        return (
                          <div
                            key={ruleIndex}
                            className="flex items-center gap-2"
                          >
                            <Input
                              className="h-8 min-w-0 flex-1 font-mono text-xs"
                              placeholder={t("ruleInputPlaceholder")}
                              value={rule}
                              onChange={(event) =>
                                updateGroupRules(groupIndex, (rules) =>
                                  rules.map((value, i) =>
                                    i === ruleIndex
                                      ? event.target.value
                                      : value,
                                  ),
                                )
                              }
                            />
                            <span className="w-14 shrink-0 text-caption text-muted-foreground">
                              {kind ? t(`kind_${kind}`) : ""}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label={t("removeRule")}
                              onClick={() =>
                                updateGroupRules(groupIndex, (rules) =>
                                  rules.filter((_, i) => i !== ruleIndex),
                                )
                              }
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-fit gap-1 text-caption"
                        disabled={
                          groupFull || customRuleTotal >= maxCustomRules
                        }
                        title={
                          groupFull
                            ? t("ruleGroupLimit", {
                                count: maxRulesPerGroup,
                              })
                            : undefined
                        }
                        onClick={() =>
                          updateGroupRules(groupIndex, (rules) => [
                            ...rules,
                            "",
                          ])
                        }
                      >
                        <Plus className="size-3" />
                        {t("addRule")}
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                className="w-fit gap-1"
                disabled={
                  overrideGroups.length >= maxRuleGroups ||
                  customRuleTotal >= maxCustomRules
                }
                title={
                  overrideGroups.length >= maxRuleGroups
                    ? t("ruleGroupLimitTotal", { count: maxRuleGroups })
                    : undefined
                }
                onClick={() => {
                  setOverrideGroups((groups) => [
                    ...groups,
                    {
                      name: "",
                      target: targetOptions[0] ?? "DIRECT",
                      enabled: true,
                      rules: [""],
                    },
                  ]);
                }}
              >
                <Plus className="size-3.5" />
                {t("addRuleGroup")}
              </Button>
            </div>

            {/* DNS 上游：主列表两核共用；备用是 Clash 的污染复核列表，sing-box 没有 */}
            <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-inset/40 p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  {t("dnsNameservers")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("dnsNameserversDesc")}
                </span>
              </div>
              <UpstreamList
                values={dnsNameservers}
                onChange={setDnsNameservers}
                presets={dnsPresets}
              />
            </div>

            {overrideFormat === "clash" && (
              <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-inset/40 p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-foreground">
                    {t("dnsFallback")}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t("dnsFallbackDesc")}
                  </span>
                </div>
                <UpstreamList
                  values={dnsFallback}
                  onChange={setDnsFallback}
                  presets={dnsFallbackPresets}
                />
              </div>
            )}

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
