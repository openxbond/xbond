import { Button, ButtonSelect, XBondIcon } from "@components";
import { ClashImportOption } from "@components/ClashImportOption";
import {
  useAccount,
  useLanguage,
  useLocalAPI,
  useSubscriptions,
} from "@stores";
import { subscriptionLang } from "@xbond/client/localapi";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./style.scss";

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
  const [clashNodesOnly, setClashNodesOnly] = useState(false);
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
        clashNodesOnly,
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
      <div className="onboarding-page">
        <div className="onboarding-card onboarding-pending">
          <XBondIcon className="onboarding-logo" />
          <strong>{t("waitingAuth")}</strong>
          {account?.userCode && (
            <div className="onboarding-device">
              <span>{t("devicePrompt")}</span>
              <code>{account.userCode}</code>
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
          <p className="onboarding-note">{t("pendingHint")}</p>
          <Button onClick={onConnectRemote}>{t("remoteOption")}</Button>
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
    <div className="onboarding-page">
      <div className="onboarding-brand">
        <XBondIcon className="onboarding-logo" />
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </div>

      {signedInNoSub && (
        <div className="onboarding-card">
          <p>
            {localStatus?.activeSub?.health === "credential_invalid"
              ? t("subscriptionInvalid")
              : t("signedInNoSub")}
          </p>
          <Button type="brand" disabled={busy} onClick={() => void onResync()}>
            {t("resync")}
          </Button>
        </div>
      )}

      {!showImport && (
        <div className="onboarding-actions">
          <Button type="brand" onClick={() => void startLogin()}>
            {t("login")}
          </Button>
          <Button
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
        <div className="onboarding-card onboarding-import">
          <div className="onboarding-import-head">
            <strong>{t("importTitle")}</strong>
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

          <ClashImportOption
            checked={clashNodesOnly}
            disabled={busy}
            onChange={setClashNodesOnly}
          />

          {mode === "url" && (
            <input
              className="onboarding-input"
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
            />
          )}

          {mode === "file" && (
            <div className="onboarding-file-row">
              <Button
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("chooseFile")}
              </Button>
              <span className="onboarding-file-name">{file?.name ?? ""}</span>
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
              className="onboarding-textarea"
              placeholder={t("pastePlaceholder")}
              value={paste}
              rows={8}
              onChange={(event) => setPaste(event.target.value)}
              disabled={busy}
            />
          )}

          {notice && <p className="onboarding-error">{notice}</p>}
          {busy && downloaded && (
            <p className="onboarding-note">
              {t("downloaded", { received: downloaded })}
            </p>
          )}

          <div className="onboarding-import-actions">
            <Button
              type="brand"
              disabled={!canSubmit}
              onClick={() => void submitImport()}
            >
              {busy ? t("importing") : t("import")}
            </Button>
            <Button disabled={busy} onClick={() => setShowImport(false)}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      )}

      {status === "error" && !showImport && (
        <div className="onboarding-card onboarding-error-card">
          <p>
            {t("loginFailed")}: {account?.error ?? ta("failed")}
          </p>
          <Button onClick={() => void startLogin()}>{tc("retry")}</Button>
        </div>
      )}
      <Button disabled={busy} onClick={onConnectRemote}>
        {t("remoteOption")}
      </Button>
    </div>
  );
}
