import type { GlobalMixin } from "@xbond/client/localapi";
import {
  Check,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLocalAPI } from "@/state/local-runtime";

import { useGlobalMixin } from "./use-global-mixin";

interface FormProps {
  initial: GlobalMixin;
  isLoading: boolean;
  daemonState: string;
  updateMixin: (mixin: GlobalMixin) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}

function GlobalMixinForm({
  initial,
  isLoading,
  daemonState,
  updateMixin,
  refresh,
}: FormProps) {
  const { t } = useTranslation("configuration");

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

  function handleReset() {
    setBypassLan(initial.bypassLan ?? false);
    setRulesPrepend((initial.rulesPrepend ?? []).join("\n"));
    setRulesAppend((initial.rulesAppend ?? []).join("\n"));
    setDns(initial.dns ?? "");
    setSaveError("");
    setDirty(false);
  }

  async function handleSave() {
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
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full max-w-4xl gap-6"
      aria-busy={saving || isLoading}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-control bg-inset ring-1 ring-border">
            <SlidersHorizontal className="size-6 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">
              {t("mixin")}
            </h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {t("mixinDesc")}
            </p>
          </div>
        </div>
      </header>

      {saveError && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
          role="alert"
        >
          <p className="font-medium text-destructive">{saveError}</p>
        </div>
      )}

      {/* Bypass LAN Toggle */}
      <section className="rounded-card border border-border bg-card p-5 shadow-elevation-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="mixin-bypass-lan"
              className="text-sm font-semibold leading-none cursor-pointer text-foreground"
            >
              {t("bypassLan")}
            </label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("bypassLanDesc")}
            </p>
          </div>
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

      {/* Prepend Rules */}
      <section className="flex flex-col rounded-card border border-border bg-card p-5 shadow-elevation-card gap-3">
        <div>
          <label
            htmlFor="mixin-rules-prepend"
            className="block text-sm font-semibold text-foreground"
          >
            {t("rulesPrepend")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("rulesPrependHelp")}
          </p>
        </div>
        <Textarea
          id="mixin-rules-prepend"
          className="font-mono"
          rows={5}
          placeholder={
            "DOMAIN-SUFFIX,internal.corp,DIRECT\nIP-CIDR,192.168.1.0/24,DIRECT"
          }
          value={rulesPrepend}
          disabled={saving || daemonState !== "ready"}
          onChange={(e) => {
            setRulesPrepend(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      </section>

      {/* Append Rules */}
      <section className="flex flex-col rounded-card border border-border bg-card p-5 shadow-elevation-card gap-3">
        <div>
          <label
            htmlFor="mixin-rules-append"
            className="block text-sm font-semibold text-foreground"
          >
            {t("rulesAppend")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("rulesAppendHelp")}
          </p>
        </div>
        <Textarea
          id="mixin-rules-append"
          className="font-mono"
          rows={5}
          placeholder={"DOMAIN-KEYWORD,blocked,PROXY\nMATCH,DIRECT"}
          value={rulesAppend}
          disabled={saving || daemonState !== "ready"}
          onChange={(e) => {
            setRulesAppend(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      </section>

      {/* Custom DNS */}
      <section className="flex flex-col rounded-card border border-border bg-card p-5 shadow-elevation-card gap-3">
        <div>
          <label
            htmlFor="mixin-custom-dns"
            className="block text-sm font-semibold text-foreground"
          >
            {t("customDns")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("customDnsHelp")}
          </p>
        </div>
        <Textarea
          id="mixin-custom-dns"
          className="font-mono"
          rows={5}
          placeholder={
            "nameserver:\n  - 223.5.5.5\n  - 119.29.29.29\nfallback:\n  - 8.8.8.8\n  - 1.1.1.1"
          }
          value={dns}
          disabled={saving || daemonState !== "ready"}
          onChange={(e) => {
            setDns(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      </section>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          variant="brand"
          disabled={saving || !dirty || daemonState !== "ready"}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
          ) : (
            <Check aria-hidden="true" className="size-4" />
          )}
          {t("saveMixin")}
        </Button>
        <Button
          variant="outline"
          disabled={saving || !dirty}
          onClick={handleReset}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t("discardChanges")}
        </Button>
      </div>
    </div>
  );
}

export default function GlobalMixinPanel() {
  const { mixin, isLoading, updateMixin, refresh } = useGlobalMixin();
  const { daemonState } = useLocalAPI();
  const formKey = `${mixin.bypassLan}-${(mixin.rulesPrepend ?? []).join(",")}-${(mixin.rulesAppend ?? []).join(",")}-${mixin.dns ?? ""}`;

  return (
    <GlobalMixinForm
      key={formKey}
      initial={mixin}
      isLoading={isLoading}
      daemonState={daemonState}
      updateMixin={updateMixin}
      refresh={refresh}
    />
  );
}
