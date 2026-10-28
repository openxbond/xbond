import { Button } from "@components/Button";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import "./style.scss";

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
    <div className="copy-control">
      <Button
        disabled={!value || status === "pending"}
        onClick={() => void copy()}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </svg>
        <span aria-live="polite">
          {status === "copied"
            ? t("copied")
            : status === "pending"
              ? t("copying")
              : label}
        </span>
      </Button>
      {status === "failed" && (
        <div className="copy-fallback">
          <p role="alert">{t("copyFailed")}</p>
          <input
            readOnly
            value={value}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}
