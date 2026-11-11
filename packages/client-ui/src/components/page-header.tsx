import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";

import { type BaseComponentProps } from "./component-props";

const PRIMARY_TABS = new Set([
  "/",
  "/connect",
  "/proxies",
  "/config",
  "/subscriptions",
  "/settings",
]);

interface HeaderProps extends BaseComponentProps {
  // header title
  title: string;
}

function BaseHeader({
  title,
  children,
  className,
  style,
  isSecondary,
  onBack,
  backLabel,
}: HeaderProps & {
  isSecondary: boolean;
  onBack?: () => void;
  backLabel: string;
}) {
  return (
    <header
      className={cn(
        "header flex min-h-9 w-full flex-wrap items-center justify-between gap-3 select-none",
        className,
      )}
      style={style}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isSecondary && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="hidden max-md:inline-flex size-8 max-md:size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border/80 bg-card text-foreground shadow-2xs transition-colors hover:bg-inset active:scale-95"
          >
            <ArrowLeft
              className="size-4 max-md:size-5 rtl:rotate-180"
              aria-hidden="true"
            />
          </button>
        )}
        <h1 className="min-w-0 text-headline leading-tight font-bold tracking-tight [overflow-wrap:anywhere] text-foreground max-md:text-title">
          {title}
        </h1>
      </div>
      <div className="flex min-w-0 flex-auto flex-wrap items-center justify-end gap-y-1">
        {children}
      </div>
    </header>
  );
}

function RouterHeader(props: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation("configuration");
  const isSecondary = !PRIMARY_TABS.has(location.pathname);

  return (
    <BaseHeader
      {...props}
      isSecondary={isSecondary}
      backLabel={t("back")}
      onBack={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate("/settings", { replace: true });
      }}
    />
  );
}

export function Header(props: HeaderProps) {
  if (useInRouterContext()) {
    return <RouterHeader {...props} />;
  }
  return <BaseHeader {...props} isSecondary={false} backLabel="Back" />;
}
