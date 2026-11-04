import { ArrowRight, Cloud, Download, Globe, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAccount } from "@/features/configuration/account/use-cloud-account";
import { cn } from "@/lib/utils";
import {
  detectImportCandidate,
  importTargetParams,
  type ImportCandidate,
} from "@/platform/desktop-shell";
import { invokeDesktop } from "@/platform/local-api-bootstrap";

interface OnboardingGuideProps {
  className?: string;
}

export function OnboardingGuide({ className }: OnboardingGuideProps) {
  const { t } = useTranslation("onboarding");
  const { t: connT } = useTranslation("connect");
  const navigate = useNavigate();
  const { account } = useAccount();
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);

  // Poll or check clipboard on mount for desktop
  useEffect(() => {
    const invoke = invokeDesktop();
    if (invoke) {
      void invoke("read_clipboard_text").then((text) => {
        if (typeof text === "string") {
          const detected = detectImportCandidate(text);
          if (detected) setCandidate(detected);
        }
      });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.readText
    ) {
      void navigator.clipboard
        .readText()
        .then((text) => {
          const detected = detectImportCandidate(text);
          if (detected) setCandidate(detected);
        })
        .catch(() => {});
    }
  }, []);

  function handleQuickImport(candidate: ImportCandidate) {
    navigate({
      pathname: "/config",
      search: importTargetParams(candidate).toString(),
    });
  }

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-5 py-4", className)}>
      {/* Welcome Header */}
      <div className="flex flex-col items-center text-center px-4 py-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 text-brand-text text-xs font-semibold mb-3">
          <Sparkles className="size-3.5" />
          <span>{t("title")}</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {/* Clipboard Sniffer Bar (if candidate detected) */}
      {candidate && (
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-card border border-brand/40 bg-brand/5 p-3.5 shadow-sm transition-all animate-in fade-in-50">
          <div className="flex min-w-0 items-center gap-2.5 pl-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground text-xs font-bold">
              ✓
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {t("importHandoffClipboard")}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[320px]">
                {candidate.value}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => handleQuickImport(candidate)}
            className="shrink-0 bg-brand text-brand-foreground hover:bg-brand-strong"
          >
            {t("importHandoffOpen")}
            <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </div>
      )}

      {/* 3 Core Paths (Three-Card Grid) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-4xl mx-auto w-full">
        {/* Option 1: XBond Cloud Account */}
        <Card
          onClick={() => navigate("/config?item=account")}
          className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-card border border-border/80 bg-card/95 p-5 shadow-elevation-card transition-all duration-200 hover:-translate-y-1 hover:border-brand hover:shadow-elevation-raised"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex size-10 items-center justify-center rounded-control bg-brand/10 text-brand-text">
                <Cloud className="size-5" />
              </div>
              <Badge
                variant="secondary"
                className="bg-brand/15 text-brand-text border-0 font-medium text-[11px]"
              >
                {account?.status === "signed_in"
                  ? connT("connected")
                  : "Recommended"}
              </Badge>
            </div>
            <h3 className="font-semibold text-foreground group-hover:text-brand-text transition-colors">
              {t("cloudCardTitle")}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("cloudCardDesc")}
            </p>
          </div>
          <div className="mt-5 flex items-center gap-1 text-xs font-medium text-brand-text">
            <span>{t("login")}</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Card>

        {/* Option 2: Universal Subscription / Paste */}
        <Card
          onClick={() => navigate("/config?item=add-profile")}
          className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-card border border-border/80 bg-card/95 p-5 shadow-elevation-card transition-all duration-200 hover:-translate-y-1 hover:border-brand hover:shadow-elevation-raised"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex size-10 items-center justify-center rounded-control bg-surface-inset text-foreground">
                <Download className="size-5" />
              </div>
            </div>
            <h3 className="font-semibold text-foreground group-hover:text-brand-text transition-colors">
              {t("subCardTitle")}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("subCardDesc")}
            </p>
          </div>
          <div className="mt-5 flex items-center gap-1 text-xs font-medium text-foreground group-hover:text-brand-text">
            <span>{t("importOption")}</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Card>

        {/* Option 3: Remote Controller */}
        <Card
          onClick={() => navigate("/config?item=add-controller")}
          className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-card border border-border/80 bg-card/95 p-5 shadow-elevation-card transition-all duration-200 hover:-translate-y-1 hover:border-brand hover:shadow-elevation-raised"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex size-10 items-center justify-center rounded-control bg-surface-inset text-foreground">
                <Globe className="size-5" />
              </div>
            </div>
            <h3 className="font-semibold text-foreground group-hover:text-brand-text transition-colors">
              {t("remoteCardTitle")}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("remoteCardDesc")}
            </p>
          </div>
          <div className="mt-5 flex items-center gap-1 text-xs font-medium text-foreground group-hover:text-brand-text">
            <span>{t("remoteOption")}</span>
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Card>
      </div>
    </div>
  );
}
