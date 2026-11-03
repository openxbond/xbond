import { Button, ButtonSelect, XBondIcon } from "@components";
import {
  useAccount,
  useLanguage,
  useLocalAPI,
  useSubscriptions,
} from "@stores";
import { subscriptionLang } from "@xbond/client/localapi";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type ImportMode = "url" | "file" | "paste";

const IMPORT_MODES: Array<{
  value: ImportMode;
  labelKey: "modeUrl" | "modeFile" | "modePaste";
}> = [
  { value: "url", labelKey: "modeUrl" },
  { value: "file", labelKey: "modeFile" },
  { value: "paste", labelKey: "modePaste" },
];

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export default function Onboarding({
  signedInNoSub = false,
  onConnectRemote,
}: {
  signedInNoSub?: boolean;
  onConnectRemote: () => void;
}) {
  const { t } = useTranslation("onboarding");
  const { t: tc } = useTranslation("common");
  const { t: ta } = useTranslation("account");
  const { lang } = useLanguage();
  const { client, status: localStatus, refresh: refreshStatus } = useLocalAPI();
  const { account, login, resync } = useAccount();
  const { addSub } = useSubscriptions();

  const [showImport, setShowImport] = useState(signedInNoSub);
  const [mode, setMode] = useState<ImportMode>("url");
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const status = account?.status ?? "signed_out";

  // The config download runs inside the daemon; mirror its byte counter so
  // the multi-minute first fetch is not a silent wait.
  useEffect(() => {
    if (!busy || !client) return;
    const timer = setInterval(async () => {
      try {
        const progress = await client.subscriptionProgress();
        if (progress.active && progress.bytes > 0) {
          setDownloaded(formatBytes(progress.bytes));
        }
      } catch {
        // Progress is best-effort; the import outcome is authoritative.
      }
    }, 500);
    return () => clearInterval(timer);
  }, [busy, client]);

  async function startLogin() {
    setNotice(null);
    try {
      await login();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function onResync() {
    setNotice(null);
    setBusy(true);
    try {
      await resync();
      await refreshStatus();
    } catch (err) {
      setNotice(t("resyncFailed"));
      void err;
    } finally {
      setBusy(false);
    }
  }

  async function readSelectedFile(): Promise<string> {
    if (!file) throw new Error(t("fileReadFailed"));
    return file.text();
  }

  async function submitImport() {
    setNotice(null);
    setDownloaded(null);
    setBusy(true);
    try {
      const params =
        mode === "url"
          ? { urlOrFile: url.trim() }
          : { content: mode === "file" ? await readSelectedFile() : paste };
      const res = await addSub({
        ...params,
        lang: subscriptionLang(lang),
      });
      await refreshStatus();
      if (res.updateError) {
        // Saved but the first fetch failed: keep the import open with the
        // reason instead of dropping the user into a config-less app.
        setNotice(res.updateError);
        return;
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setBusy(false);
    }
  }

  if (status === "pending") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <div className="flex w-[min(520px,100%)] flex-col items-center gap-3 rounded-card border border-border bg-card p-5 text-center">
          <XBondIcon className="size-12 text-foreground" />
          <strong>{t("waitingAuth")}</strong>
          {account?.userCode && (
            <div className="flex flex-col gap-1.5">
              <span>{t("devicePrompt")}</span>
              <code className="rounded-sm bg-inset px-4 py-2 text-2xl font-bold tracking-[2px]">
                {account.userCode}
              </code>
            </div>
          )}
          {account?.authUrl && (
            <a href={account.authUrl} target="_blank" rel="noreferrer">
              {t("reopenAuth")}
            </a>
          )}
          {!account?.authUrl && account?.verificationUri && (
            <a href={account.verificationUri} target="_blank" rel="noreferrer">
              {t("reopenAuth")}
            </a>
          )}
          <p className="text-xs text-muted-foreground">{t("pendingHint")}</p>
          <Button className="min-h-11" onClick={onConnectRemote}>
            {t("remoteOption")}
          </Button>
        </div>
      </div>
    );
  }

  const canSubmit =
    !busy &&
    (mode === "url"
      ? url.trim() !== ""
      : mode === "file"
        ? file !== null
        : paste.trim() !== "");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <XBondIcon className="size-12 text-foreground" />
        <h1 className="m-0 text-headline">{t("title")}</h1>
        <p className="m-0 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {signedInNoSub && (
        <div className="flex w-[min(520px,100%)] flex-col items-center gap-3 rounded-card border border-border bg-card p-5 text-center">
          <p className="m-0 text-sm">
            {localStatus?.activeSub?.health === "credential_invalid"
              ? t("subscriptionInvalid")
              : t("signedInNoSub")}
          </p>
          <Button
            variant="brand"
            className="min-h-11"
            disabled={busy}
            onClick={() => void onResync()}
          >
            {t("resync")}
          </Button>
        </div>
      )}

      {!showImport && (
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            variant="brand"
            className="min-h-11"
            onClick={() => void startLogin()}
          >
            {t("login")}
          </Button>
          <Button
            className="min-h-11"
            onClick={() => {
              setNotice(null);
              setShowImport(true);
            }}
          >
            {t("importOption")}
          </Button>
        </div>
      )}

      {showImport && (
        <div className="flex w-[min(520px,100%)] flex-col items-center gap-3 rounded-card border border-border bg-card p-5 text-left">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong className="text-subtitle">{t("importTitle")}</strong>
            <ButtonSelect<ImportMode>
              value={mode}
              options={IMPORT_MODES.map((entry) => ({
                value: entry.value,
                label: t(entry.labelKey),
              }))}
              onSelect={(next) => {
                setMode(next);
                setNotice(null);
              }}
            />
          </div>

          {mode === "url" && (
            <input
              className="w-full rounded-sm border border-border bg-inset px-3 py-2.5 text-body text-foreground"
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
            />
          )}

          {mode === "file" && (
            <div className="flex items-center gap-3">
              <Button
                className="min-h-11"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("chooseFile")}
              </Button>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-body text-muted-foreground">
                {file?.name ?? ""}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.yaml,.yml,.conf,.txt"
                hidden
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {mode === "paste" && (
            <textarea
              className="w-full resize-y rounded-sm border border-border bg-inset px-3 py-2.5 font-mono text-body leading-normal text-foreground"
              placeholder={t("pastePlaceholder")}
              value={paste}
              rows={8}
              onChange={(event) => setPaste(event.target.value)}
              disabled={busy}
            />
          )}

          {notice && (
            <p className="break-all text-body text-[#e5484d]">{notice}</p>
          )}
          {busy && downloaded && (
            <p className="text-xs text-muted-foreground">
              {t("downloaded", { received: downloaded })}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant="brand"
              className="min-h-11"
              disabled={!canSubmit}
              onClick={() => void submitImport()}
            >
              {busy ? t("importing") : t("import")}
            </Button>
            <Button
              className="min-h-11"
              disabled={busy}
              onClick={() => setShowImport(false)}
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      )}

      {status === "error" && !showImport && (
        <div className="flex w-[min(520px,100%)] flex-col items-center gap-3 rounded-card border border-border bg-card p-5 text-center">
          <p className="m-0 break-all text-sm">
            {t("loginFailed")}: {account?.error ?? ta("failed")}
          </p>
          <Button className="min-h-11" onClick={() => void startLogin()}>
            {tc("retry")}
          </Button>
        </div>
      )}
      <Button className="min-h-11" disabled={busy} onClick={onConnectRemote}>
        {t("remoteOption")}
      </Button>
    </div>
  );
}
