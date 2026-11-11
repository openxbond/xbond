import {
  ArrowRight,
  Check,
  Cloud,
  Download,
  Globe,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
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

/** One first-run path. The whole card is the click target; the pill at the
 * bottom names the action so the affordance is visible before hover. */
function PathCard({
  onActivate,
  icon,
  tileClassName,
  pillClassName,
  title,
  desc,
  cta,
  badge,
}: {
  onActivate: () => void;
  icon: ReactNode;
  tileClassName: string;
  pillClassName: string;
  title: string;
  desc: string;
  cta: string;
  badge?: ReactNode;
}) {
  return (
    <Card
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
      className="bento-interactive group relative flex cursor-pointer flex-col justify-between overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
    >
      {badge && <div className="absolute end-4 top-4">{badge}</div>}
      <div>
        <div
          className={cn(
            "mb-4 grid size-10 place-items-center rounded-lg",
            tileClassName,
          )}
        >
          {icon}
        </div>
        <h3 className="font-semibold text-foreground transition-colors group-hover:text-brand-text">
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {desc}
        </p>
      </div>
      <span
        className={cn(
          "mt-5 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          pillClassName,
        )}
      >
        {cta}
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Card>
  );
}

export function OnboardingGuide({ className }: OnboardingGuideProps) {
  const { t } = useTranslation("onboarding");
  const { t: acc } = useTranslation("account");
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

  const neutralPill =
    "border-[var(--glass-border)] bg-inset text-foreground group-hover:border-brand/30 group-hover:bg-brand-soft group-hover:text-brand-text";

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-4 py-4", className)}>
      {/* Welcome Header */}
      <div className="flex flex-col items-center px-4 py-2 text-center">
        <span className="mb-4 grid size-9 place-items-center rounded-control border border-border bg-card text-brand-text">
          <Sparkles className="size-[18px]" />
        </span>
        <h2 className="text-title font-semibold leading-tight tracking-[-0.03em] text-foreground">
          {t("title")}
        </h2>
        <p className="mt-2 max-w-lg text-label leading-5 text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {/* Clipboard Sniffer Bar (if candidate detected) */}
      {candidate && (
        <div className="mx-auto flex w-full max-w-2xl animate-in items-center justify-between gap-3 rounded-card border border-brand/40 bg-brand-soft/50 p-3.5 fade-in-50 slide-in-from-top-2 duration-300">
          <div className="flex min-w-0 items-center gap-2.5 pl-1">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-action text-brand-action-foreground">
              <Check className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {t("importHandoffClipboard")}
              </p>
              <p className="text-caption text-muted-foreground font-mono truncate max-w-[320px]">
                {candidate.value}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="brand"
            onClick={() => handleQuickImport(candidate)}
            className="shrink-0"
          >
            {t("importHandoffOpen")}
            <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </div>
      )}

      {/* 3 Core Paths (Three-Card Grid) */}
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3 max-md:pb-12">
        {/* Option 1: XBond Cloud Account */}
        <PathCard
          onActivate={() => navigate("/config?item=cloud")}
          icon={<Cloud aria-hidden="true" className="size-5" />}
          tileClassName="bg-brand/15 text-brand-text"
          pillClassName="border-brand/30 bg-brand-soft text-brand-text"
          title={t("cloudCardTitle")}
          desc={t("cloudCardDesc")}
          cta={t("login")}
          badge={
            <Badge
              variant="secondary"
              className="border-0 bg-brand-soft text-caption font-medium text-brand-text"
            >
              {account?.status === "signed_in"
                ? acc("signedIn")
                : t("recommended")}
            </Badge>
          }
        />

        {/* Option 2: Universal Subscription / Paste */}
        <PathCard
          onActivate={() => navigate("/config?item=add-profile")}
          icon={<Download aria-hidden="true" className="size-5" />}
          tileClassName="border border-[var(--glass-border)] bg-inset text-muted-foreground"
          pillClassName={neutralPill}
          title={t("subCardTitle")}
          desc={t("subCardDesc")}
          cta={t("importOption")}
        />

        {/* Option 3: Existing Proxy Service */}
        <PathCard
          onActivate={() => navigate("/config?item=add-controller")}
          icon={<Globe aria-hidden="true" className="size-5" />}
          tileClassName="border border-[var(--glass-border)] bg-inset text-muted-foreground"
          pillClassName={neutralPill}
          title={t("remoteCardTitle")}
          desc={t("remoteCardDesc")}
          cta={t("remoteOption")}
        />
      </div>
    </div>
  );
}
