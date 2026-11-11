import type { GlobalMixin } from "@xbond/client/localapi";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileCode,
  Globe,
  LoaderCircle,
  Network,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { errorKind } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { useLocalAPI } from "@/state/local-runtime";

import { useGlobalMixin } from "./use-global-mixin";

interface QuickSnippet {
  label: string;
  snippet: string;
}

interface PresetTemplate {
  name: string;
  content: string;
}

interface RuleEditorProps {
  id: string;
  title: string;
  badgeLabel?: string;
  badgeVariant?: "brand" | "purple" | "neutral";
  helpText: string;
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (val: string) => void;
  quickSnippets?: QuickSnippet[];
  presets?: PresetTemplate[];
}

function RuleCodeEditor({
  id,
  title,
  badgeLabel,
  badgeVariant = "brand",
  helpText,
  placeholder,
  value,
  disabled,
  onChange,
  quickSnippets = [],
  presets = [],
}: RuleEditorProps) {
  const { t } = useTranslation("configuration");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const activeRuleCount = useMemo(() => {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")).length;
  }, [value]);

  const lineNumbers = useMemo(() => {
    const count = (value || "").split("\n").length;
    return Array.from({ length: Math.max(count, 5) }, (_, i) => i + 1);
  }, [value]);

  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleInsertSnippet = (snippet: string) => {
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) {
      const next = value ? `${value.trimEnd()}\n${snippet}` : snippet;
      onChange(next);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = value.substring(0, start);
    const after = value.substring(end);
    const needsNewlineBefore = before.length > 0 && !before.endsWith("\n");
    const insertText = (needsNewlineBefore ? "\n" : "") + snippet + "\n";
    const nextValue = before + insertText + after;
    onChange(nextValue);

    setTimeout(() => {
      textarea.focus();
      const newPos = start + insertText.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const nextValue = `${value.substring(0, start)}  ${value.substring(end)}`;
      onChange(nextValue);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  return (
    <div className="bento flex flex-col gap-3 p-4 xl:p-5">
      {/* 头部：标题 + 标识徽章 + 规则条数感知 + 工具动作 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <label
            htmlFor={id}
            className="cursor-pointer text-sm font-semibold tracking-tight text-foreground select-none"
          >
            {title}
          </label>
          {badgeLabel && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold border shadow-2xs",
                badgeVariant === "brand" &&
                  "border-brand/20 bg-brand-soft text-brand-text",
                badgeVariant === "purple" &&
                  "border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-400",
                badgeVariant === "neutral" &&
                  "border-border bg-muted/60 text-muted-foreground",
              )}
            >
              {badgeLabel}
            </span>
          )}
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {activeRuleCount > 0
              ? t("rulesCountActive", { count: activeRuleCount })
              : t("noRulesConfigured")}
          </span>
        </div>

        {/* 快捷动作栏：清空 + 预设模板 */}
        <div className="flex items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = value
                  ? `${value.trimEnd()}\n${preset.content}`
                  : preset.content;
                onChange(next);
              }}
              className="inline-flex min-h-6 items-center rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs transition-[color,border-color,background-color,transform] duration-150 hover:border-brand/40 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
            >
              + {preset.name}
            </button>
          ))}
          {value.trim().length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange("")}
              className="inline-flex min-h-6 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer transition-colors"
              title={t("clearAll")}
            >
              <Trash2 className="size-3" aria-hidden="true" />
              <span>{t("clearAll")}</span>
            </button>
          )}
        </div>
      </div>

      {/* 描述与语法快捷插入胶囊 */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed xl:text-xs">
          {helpText}
        </p>

        {quickSnippets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {t("quickInsert")}:
            </span>
            {quickSnippets.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={disabled}
                onClick={() => handleInsertSnippet(item.snippet)}
                className="inline-flex items-center rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground/80 hover:bg-brand/15 hover:text-brand-text active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 沉浸式专业代码编辑器卡片 */}
      <div className="relative flex overflow-hidden rounded-xl border border-border/80 bg-inset/40 shadow-inner transition-[border-color,box-shadow] duration-150 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/20">
        {/* 左侧行号指示器（像素级同步滚动） */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="hidden sm:flex flex-col shrink-0 select-none overflow-hidden border-r border-border/60 bg-muted/20 py-2.5 pe-2.5 ps-3 text-right font-mono text-[11px] leading-6 text-muted-foreground/35 tabular-nums"
        >
          {lineNumbers.map((num) => (
            <span key={num} className="h-6">
              {num}
            </span>
          ))}
        </div>

        {/* 右侧规则代码编辑区 */}
        <textarea
          ref={textareaRef}
          id={id}
          rows={5}
          value={value}
          disabled={disabled}
          onScroll={syncScroll}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          className="size-full min-h-[130px] max-h-[340px] resize-none overflow-y-auto bg-transparent py-2.5 px-3 font-mono text-xs xl:text-sm leading-6 text-foreground placeholder:text-muted-foreground/40 outline-none selection:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>
  );
}

interface FormProps {
  initial: GlobalMixin;
  isLoading: boolean;
  daemonState: string;
  isConnected?: boolean;
  updateMixin: (mixin: GlobalMixin) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}

function GlobalMixinForm({
  initial,
  isLoading,
  daemonState,
  isConnected,
  updateMixin,
  refresh,
}: FormProps) {
  const { t } = useTranslation("configuration");
  const { t: tr } = useTranslation("rules");
  const { t: common } = useTranslation("common");
  const { t: rt } = useTranslation("runtime");

  const [bypassLan, setBypassLan] = useState(initial.bypassLan ?? false);
  const [rulesPrepend, setRulesPrepend] = useState(
    (initial.rulesPrepend ?? []).join("\n"),
  );
  const [rulesAppend, setRulesAppend] = useState(
    (initial.rulesAppend ?? []).join("\n"),
  );
  const [dns, setDns] = useState(initial.dns ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [dnsExpanded, setDnsExpanded] = useState(Boolean(initial.dns?.trim()));

  function handleReset() {
    setBypassLan(initial.bypassLan ?? false);
    setRulesPrepend((initial.rulesPrepend ?? []).join("\n"));
    setRulesAppend((initial.rulesAppend ?? []).join("\n"));
    setDns(initial.dns ?? "");
    setSaveError("");
    setDirty(false);
  }

  const handleSave = useCallback(async () => {
    if (saving || daemonState !== "ready") return;
    setSaving(true);
    setSaveError("");
    try {
      const parsedPrepend = rulesPrepend
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedAppend = rulesAppend
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      await updateMixin({
        bypassLan,
        rulesPrepend: parsedPrepend,
        rulesAppend: parsedAppend,
        dns: dns.trim() || undefined,
      });
      await refresh();
      setDirty(false);
      toast.success(t("mixinSaved"));
    } catch (err) {
      // WebKit surfaces aborted requests as a bare "Load failed"; map
      // network-level failures to the localized runtime copy and keep the
      // server's own message (validation) verbatim.
      const kind = errorKind(err, true);
      setSaveError(
        kind === "requestFailed"
          ? err instanceof Error
            ? err.message
            : String(err)
          : rt(kind),
      );
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    daemonState,
    rulesPrepend,
    rulesAppend,
    updateMixin,
    bypassLan,
    dns,
    refresh,
    t,
    rt,
  ]);

  // 支持全局键盘快捷键 Ctrl+S / ⌘S 快速保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !saving && daemonState === "ready") {
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, saving, daemonState, handleSave]);

  return (
    <div
      className="flex flex-col w-full max-w-5xl gap-4 pb-12"
      aria-busy={saving || isLoading}
    >
      {/* 模块 1：分流增强机制说明与执行流程流水线 */}
      <section className="bento flex flex-col gap-3.5 p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand shadow-2xs"
            >
              <Sparkles className="size-4.5" />
            </span>
            <div>
              <h2 className="text-body font-bold tracking-tight text-foreground">
                {t("mixin")}
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                {t("mixinDesc")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <Badge
                variant="outline"
                className="border-warning/30 bg-warning/10 text-warning text-xs font-medium"
              >
                {tr("mixinDisconnectedHint")}
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="text-xs font-mono font-medium"
              >
                {dirty ? t("unsavedNotice") : t("ready")}
              </Badge>
            )}
          </div>
        </div>

        {/* 规则执行生命周期流水线卡片 */}
        <div className="rounded-xl border border-border/70 bg-inset/50 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs select-none">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium shadow-2xs transition-colors",
                bypassLan
                  ? "border-success/30 bg-success-soft text-success"
                  : "border-border/60 bg-card text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  bypassLan ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              {t("pipelineLan")}
            </span>

            <ArrowRight
              aria-hidden="true"
              className="size-3 text-muted-foreground/40 shrink-0"
            />

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-soft px-2.5 py-1 font-medium text-brand-text shadow-2xs">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-brand"
              />
              {t("pipelinePrepend")}
            </span>

            <ArrowRight
              aria-hidden="true"
              className="size-3 text-muted-foreground/40 shrink-0"
            />

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 font-medium text-muted-foreground">
              {t("pipelineConfig")}
            </span>

            <ArrowRight
              aria-hidden="true"
              className="size-3 text-muted-foreground/40 shrink-0"
            />

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2.5 py-1 font-medium text-purple-600 dark:text-purple-400 shadow-2xs">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-purple-500"
              />
              {t("pipelineAppend")}
            </span>

            <ArrowRight
              aria-hidden="true"
              className="size-3 text-muted-foreground/40 shrink-0"
            />

            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 font-medium text-muted-foreground">
              {t("pipelineFinal")}
            </span>
          </div>
        </div>
      </section>

      {saveError && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive"
          role="alert"
        >
          <p className="font-semibold">{saveError}</p>
        </div>
      )}

      {/* 模块 2：局域网与私有地址直连 Bento 开关卡片 */}
      <section className="bento flex items-center justify-between gap-4 p-4 xl:p-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-500"
          >
            <Network className="size-4.5" />
          </span>
          <div className="min-w-0">
            <label
              htmlFor="mixin-bypass-lan"
              className="cursor-pointer text-sm font-semibold tracking-tight text-foreground"
            >
              {t("bypassLan")}
            </label>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              {t("bypassLanDesc")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={cn(
              "text-xs font-medium transition-colors select-none",
              bypassLan
                ? "text-brand-text font-semibold"
                : "text-muted-foreground",
            )}
          >
            {bypassLan ? t("ready") : t("updateDisabled")}
          </span>
          <Switch
            id="mixin-bypass-lan"
            checked={bypassLan}
            disabled={saving || daemonState !== "ready"}
            onCheckedChange={(val) => {
              setBypassLan(val);
              setDirty(true);
            }}
          />
        </div>
      </section>

      {/* 模块 3：前置分流规则专业代码编辑器 */}
      <RuleCodeEditor
        id="mixin-rules-prepend"
        title={t("rulesPrepend")}
        badgeLabel={t("mixinBadgePrepend")}
        badgeVariant="brand"
        helpText={t("rulesPrependHelp")}
        placeholder={t("rulesPrependPlaceholder")}
        value={rulesPrepend}
        disabled={saving || daemonState !== "ready"}
        onChange={(val) => {
          setRulesPrepend(val);
          setDirty(true);
        }}
        quickSnippets={[
          {
            label: "DOMAIN-SUFFIX",
            snippet: "DOMAIN-SUFFIX,example.com,DIRECT",
          },
          { label: "DOMAIN", snippet: "DOMAIN,service.internal,DIRECT" },
          { label: "IP-CIDR", snippet: "IP-CIDR,10.0.0.0/8,DIRECT" },
          { label: "DIRECT", snippet: "DOMAIN-SUFFIX,local,DIRECT" },
          { label: "PROXY", snippet: "DOMAIN-SUFFIX,google.com,PROXY" },
        ]}
        presets={[
          {
            name: t("presetInternalCorp"),
            content:
              "DOMAIN-SUFFIX,internal,DIRECT\nDOMAIN-SUFFIX,corp,DIRECT\nIP-CIDR,10.0.0.0/8,DIRECT\nIP-CIDR,172.16.0.0/12,DIRECT\nIP-CIDR,192.168.0.0/16,DIRECT",
          },
        ]}
      />

      {/* 模块 4：后置分流规则专业代码编辑器 */}
      <RuleCodeEditor
        id="mixin-rules-append"
        title={t("rulesAppend")}
        badgeLabel={t("mixinBadgeAppend")}
        badgeVariant="purple"
        helpText={t("rulesAppendHelp")}
        placeholder={t("rulesAppendPlaceholder")}
        value={rulesAppend}
        disabled={saving || daemonState !== "ready"}
        onChange={(val) => {
          setRulesAppend(val);
          setDirty(true);
        }}
        quickSnippets={[
          {
            label: "DOMAIN-KEYWORD",
            snippet: "DOMAIN-KEYWORD,telemetry,REJECT",
          },
          { label: "GEOIP,CN", snippet: "GEOIP,CN,DIRECT" },
          { label: "REJECT", snippet: "DOMAIN-SUFFIX,tracker.com,REJECT" },
          { label: "MATCH", snippet: "MATCH,DIRECT" },
        ]}
        presets={[
          {
            name: t("presetSecurityBlock"),
            content:
              "DOMAIN-KEYWORD,analytics,REJECT\nDOMAIN-KEYWORD,telemetry,REJECT\nDOMAIN-KEYWORD,tracking,REJECT",
          },
        ]}
      />

      {/* 模块 5：全局 DNS 覆盖专家选项（可折叠） */}
      <section className="bento flex flex-col gap-3 p-4 xl:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400"
            >
              <Globe className="size-4.5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("customDns")}
                </h3>
                <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("expertOption")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                {t("customDnsHelp")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDnsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground cursor-pointer transition-colors"
          >
            <span>{dnsExpanded ? common("close") : t("edit")}</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform duration-200",
                dnsExpanded && "rotate-180",
              )}
            />
          </button>
        </div>

        {dnsExpanded && (
          <div className="pt-2 flex animate-in flex-col gap-3 border-t border-border/60 fade-in-50 slide-in-from-top-1 duration-200">
            {/* DNS 预设模版快捷载入 */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] text-muted-foreground font-mono">
                {t("loadPreset")}:
              </span>
              <button
                type="button"
                disabled={saving || daemonState !== "ready"}
                onClick={() => {
                  setDns(
                    "nameserver:\n  - 223.5.5.5\n  - 223.6.6.6\nfallback:\n  - 119.29.29.29",
                  );
                  setDirty(true);
                }}
                className="inline-flex items-center rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs hover:border-brand/40 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer transition-colors"
              >
                + {t("presetAliDns")}
              </button>
              <button
                type="button"
                disabled={saving || daemonState !== "ready"}
                onClick={() => {
                  setDns(
                    "nameserver:\n  - 119.29.29.29\n  - 182.254.116.116\nfallback:\n  - 223.5.5.5",
                  );
                  setDirty(true);
                }}
                className="inline-flex items-center rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs hover:border-brand/40 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer transition-colors"
              >
                + {t("presetTencentDns")}
              </button>
              <button
                type="button"
                disabled={saving || daemonState !== "ready"}
                onClick={() => {
                  setDns(
                    "nameserver:\n  - 223.5.5.5\n  - 119.29.29.29\nfallback:\n  - 8.8.8.8\n  - 1.1.1.1",
                  );
                  setDirty(true);
                }}
                className="inline-flex items-center rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs hover:border-brand/40 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40 cursor-pointer transition-colors"
              >
                + {t("presetGoogleCloudflareDns")}
              </button>
              {dns.trim().length > 0 && (
                <button
                  type="button"
                  disabled={saving || daemonState !== "ready"}
                  onClick={() => {
                    setDns("");
                    setDirty(true);
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors ms-auto"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  <span>{t("clearAll")}</span>
                </button>
              )}
            </div>

            <div className="relative flex overflow-hidden rounded-xl border border-border/80 bg-inset/40 shadow-inner focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/20 transition-all">
              <textarea
                id="mixin-custom-dns"
                rows={5}
                value={dns}
                disabled={saving || daemonState !== "ready"}
                onChange={(e) => {
                  setDns(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                placeholder={
                  "nameserver:\n  - 223.5.5.5\n  - 119.29.29.29\nfallback:\n  - 8.8.8.8\n  - 1.1.1.1"
                }
                className="size-full min-h-[120px] max-h-[300px] resize-none overflow-y-auto bg-transparent py-2.5 px-3 font-mono text-xs xl:text-sm leading-6 text-foreground placeholder:text-muted-foreground/40 outline-none selection:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </section>

      {/* 模块 6：悬浮高质感保存控制栏（当有修改时醒目展现，支持快捷键 ⌘S） */}
      {dirty && (
        <aside
          aria-label={t("saveMixin")}
          className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-card/95 p-3.5 shadow-elevation-flyout backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand"
            >
              <FileCode className="size-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">
                {t("unsavedNotice")}
              </p>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                {t("pressToSave")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={handleReset}
              className="cursor-pointer"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              <span>{t("discardChanges")}</span>
            </Button>
            <Button
              variant="brand"
              size="sm"
              disabled={saving || daemonState !== "ready"}
              onClick={() => void handleSave()}
              className="cursor-pointer font-semibold shadow-xs"
            >
              {saving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 motion-safe:animate-spin"
                />
              ) : (
                <Check aria-hidden="true" className="size-3.5" />
              )}
              <span>{t("saveMixin")}</span>
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}

export default function GlobalMixinPanel({
  isConnected,
}: {
  isConnected?: boolean;
}) {
  const { mixin, isLoading, updateMixin, refresh } = useGlobalMixin();
  const { daemonState } = useLocalAPI();
  const formKey = `${mixin.bypassLan}-${(mixin.rulesPrepend ?? []).join(",")}-${(mixin.rulesAppend ?? []).join(",")}-${mixin.dns ?? ""}`;

  return (
    <GlobalMixinForm
      key={formKey}
      initial={mixin}
      isLoading={isLoading}
      daemonState={daemonState}
      isConnected={isConnected}
      updateMixin={updateMixin}
      refresh={refresh}
    />
  );
}
