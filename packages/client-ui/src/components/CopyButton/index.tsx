import { Button } from "@components/ui/button";
import { Check, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation("common");
  const [feedback, setFeedback] = useState<{
    value: string;
    status: "pending" | "copied" | "failed";
  } | null>(null);
  const status = feedback?.value === value ? feedback.status : "idle";
  const setStatus = (status: "pending" | "copied" | "failed") =>
    setFeedback({ value, status });
  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [status]);
  async function copy() {
    setStatus("pending");
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <div className="inline-flex min-w-0 flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={!value || status === "pending"}
        onClick={() => void copy()}
      >
        <CopyIcon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span aria-live="polite">
          {status === "copied"
            ? t("copied")
            : status === "pending"
              ? t("copying")
              : label}
        </span>
      </Button>
      {status === "failed" && (
        <div className="basis-full text-xs leading-[1.6] text-destructive-text">
          <p role="alert">{t("copyFailed")}</p>
          <input
            readOnly
            value={value}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1.5 min-h-9 w-full rounded-md border border-input bg-inset p-2 font-mono text-foreground max-md:min-h-11"
          />
        </div>
      )}
    </div>
  );
}

/** 行內圖示版：用於密集清單（如規則表），就地回饋已複製。 */
export function CopyIconButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const { t } = useTranslation("common");
  const [status, setStatus] = useState<
    "idle" | "pending" | "copied" | "failed"
  >("idle");
  useEffect(() => {
    if (status !== "copied" && status !== "failed") return;
    const timer = setTimeout(() => setStatus("idle"), 2400);
    return () => clearTimeout(timer);
  }, [status]);
  async function copy() {
    setStatus("pending");
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={!value || status === "pending"}
      aria-label={status === "copied" ? t("copied") : label}
      title={status === "copied" ? t("copied") : label}
      onClick={() => void copy()}
    >
      {status === "copied" ? (
        <Check className="size-4 text-success" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-4" aria-hidden="true" />
      )}
      {status === "failed" && (
        <span role="alert" className="sr-only">
          {t("copyFailed")}
        </span>
      )}
    </Button>
  );
}
