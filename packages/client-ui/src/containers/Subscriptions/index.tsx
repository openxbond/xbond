import {
  Header,
  Button,
  ButtonSelect,
  Input,
  Modal,
  success,
  QuotaRing,
  Stat,
} from "@components";
import { CopyButton } from "@components/CopyButton";
import { RequestStatus } from "@components/RequestStatus";
import { useAction } from "@lib/actions";
import { useLanguage, useLocalAPI, useSubscriptions } from "@stores";
import { formatTraffic } from "@xbond/client/helper";
import { subscriptionLang, subscriptionQuota } from "@xbond/client/localapi";
import { workspaceLink } from "@xbond/client/workspace";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import "./style.scss";

export default function Subscriptions() {
  const { lang } = useLanguage();
  const { t } = useTranslation("subscriptions");
  const { t: tc } = useTranslation("common");
  const { t: c } = useTranslation("connect");
  const { t: sb } = useTranslation("sidebar");
  const location = useLocation();
  const [params] = useSearchParams();
  const { hasLocalAPI, status, refresh, client: localClient } = useLocalAPI();
  const {
    subscriptions,
    activeId,
    addSub,
    selectSub,
    updateSub,
    removeSub,
    renameSub,
    error: subError,
    refresh: refreshSubs,
  } = useSubscriptions();

  const { run, pending } = useAction();
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [importError, setImportError] = useState("");
  const track = params.get("track") === "universal" ? "universal" : "xbond";
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importFeedback, setImportFeedback] = useState<
    "idle" | "success" | "failed"
  >("idle");
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overridePrepend, setOverridePrepend] = useState("");
  const [overrideAppend, setOverrideAppend] = useState("");
  const [overrideDns, setOverrideDns] = useState("");
  const [overrideError, setOverrideError] = useState("");
  const [proxyChannelId, setProxyChannelId] = useState<string | null>(null);
  const [proxyChannelUrl, setProxyChannelUrl] = useState("");

  const link = (values: Record<string, string> = {}) =>
    workspaceLink(location.search, "/subscriptions", values);

  function lines(value: string): string[] {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function openOverride(id: string) {
    setOverrideId(id);
    setOverrideError("");
    setOverridePrepend("");
    setOverrideAppend("");
    setOverrideDns("");
    if (!localClient) return;
    try {
      const current = await localClient.getSubOverride(id);
      setOverridePrepend((current.rulesPrepend ?? []).join("\n"));
      setOverrideAppend((current.rulesAppend ?? []).join("\n"));
      setOverrideDns(current.dns ?? "");
    } catch (error) {
      setOverrideError(String(error));
    }
  }

  async function saveOverride() {
    if (!overrideId || !localClient) return;
    setOverrideError("");
    try {
      await localClient.setSubOverride(overrideId, {
        rulesPrepend: lines(overridePrepend),
        rulesAppend: lines(overrideAppend),
        dns: overrideDns.trim() || undefined,
      });
      await refresh();
      setOverrideId(null);
      success(t("overrideSaved"));
    } catch (error) {
      // Conflicts (missing policies, core-gate failures) stay in the dialog
      // so the text survives for editing.
      setOverrideError(error instanceof Error ? error.message : String(error));
    }
  }

  // Channel "proxy" needs a URL first: the modal collects it, other
  // channels persist immediately.
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
    });
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
    });
  }

  function rollback(id: string) {
    void run(async () => {
      if (!localClient) throw new Error("LocalAPI not available");
      await localClient.rollbackSub(id);
      await refresh();
      success(t("rollbackDone"));
    });
  }

  async function add() {
    setImportFeedback("idle");
    setImportError("");
    const ok = await run(async () => {
      const result = await addSub({
        ...(track === "xbond"
          ? { token: token.trim() }
          : { urlOrFile: url.trim() }),
        name: name.trim() || undefined,
        lang: subscriptionLang(lang),
      });
      await refresh();
      if (result.updateError) {
        setImportError(result.updateError);
        throw new Error(result.updateError);
      }
    }, false);
    if (ok) {
      setToken("");
      setUrl("");
      setName("");
      setImportFeedback("success");
      success(t("imported"));
    } else {
      setImportFeedback("failed");
    }
  }

  return (
    <div className="page subscriptions-page">
      <Header title={t("title")}>
        <div className="subscriptions-header-actions">
          {hasLocalAPI && subscriptions.length > 1 && (
            <Button
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  if (localClient) await localClient.updateSub();
                  await refresh();
                  await refreshSubs();
                })
              }
            >
              {t("updateBtn")}
            </Button>
          )}
        </div>
      </Header>

      {hasLocalAPI ? (
        <>
          <section
            className="subscription-import-card card"
            aria-label={t("import")}
          >
            <div className="subscription-import-tabs">
              <Link
                to={link({ track: "xbond" })}
                className={track === "xbond" ? "active" : undefined}
                aria-current={track === "xbond" ? "page" : undefined}
              >
                {t("xbondTrack")}
              </Link>
              <Link
                to={link({ track: "universal" })}
                className={track === "universal" ? "active" : undefined}
                aria-current={track === "universal" ? "page" : undefined}
              >
                {t("universalTrack")}
              </Link>
            </div>

            {track === "xbond" && (
              <p className="subscription-track-note">{t("bindNote")}</p>
            )}

            <form
              className="subscription-import-form"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <div className="import-inputs">
                <label className="import-field">
                  <span className="import-label">
                    {track === "xbond" ? t("xbondTrack") : t("universalTrack")}
                  </span>
                  <Input
                    type={track === "xbond" ? "password" : "text"}
                    value={track === "xbond" ? token : url}
                    onChange={track === "xbond" ? setToken : setUrl}
                    placeholder={
                      track === "xbond"
                        ? t("tokenPlaceholder")
                        : t("urlPlaceholder")
                    }
                    align="left"
                  />
                </label>
                <label className="import-field name-field">
                  <span className="import-label">{t("namePlaceholder")}</span>
                  <Input
                    value={name}
                    onChange={setName}
                    placeholder={t("namePlaceholder")}
                    align="left"
                  />
                </label>
                <button
                  type="submit"
                  className="button button-brand import-submit-btn"
                  disabled={
                    pending || !(track === "xbond" ? token : url).trim()
                  }
                >
                  {pending
                    ? tc("loading")
                    : track === "universal"
                      ? t("import")
                      : t("addBtn")}
                </button>
              </div>
            </form>

            {importFeedback !== "idle" && (
              <div
                className={"import-feedback-banner " + importFeedback}
                role={importFeedback === "failed" ? "alert" : "status"}
              >
                <span>
                  {t(
                    importFeedback === "success" ? "imported" : "importFailed",
                  )}
                  {importError && <span className="block">{importError}</span>}
                </span>
                {importFeedback === "success" && (
                  <Link
                    className="section-link ml-2"
                    to={workspaceLink(location.search, "/connect")}
                  >
                    {sb("home")} &rarr;
                  </Link>
                )}
              </div>
            )}
          </section>

          <RequestStatus error={subError} retry={refreshSubs} />

          <section
            className="subscriptions-grid-section"
            aria-label={t("title")}
          >
            <div className="section-heading">
              <h2>{t("title")}</h2>
              <span className="subscriptions-count">
                {t("count", { count: subscriptions.length })}
              </span>
            </div>

            {subscriptions.length > 0 ? (
              <div className="subscriptions-grid">
                {subscriptions.map((sub) => {
                  const quota = subscriptionQuota(sub);
                  const isActive = sub.id === activeId;
                  return (
                    <article
                      className={`subscription-card card ${isActive ? "is-active" : ""}`}
                      key={sub.id}
                    >
                      <div className="sub-card-header">
                        <div className="sub-title-group">
                          <h3 className="sub-name">{sub.name}</h3>
                          <div className="sub-badges">
                            <span className="sub-type-badge">
                              {sub.type === "xbond"
                                ? t("typeXbond")
                                : t("typeUniversal")}
                            </span>
                            {isActive && (
                              <span className="sub-active-badge">
                                {t("active")}
                              </span>
                            )}
                          </div>
                        </div>
                        {!isActive && (
                          <Button
                            disabled={pending}
                            onClick={() =>
                              void run(async () => {
                                await selectSub(sub.id);
                                await refresh();
                              })
                            }
                          >
                            {t("use")}
                          </Button>
                        )}
                      </div>

                      <div className="sub-card-body">
                        {quota ? (
                          <div className="sub-quota-row">
                            <QuotaRing percent={quota.remainingPercent} />
                            <div className="sub-quota-numbers">
                              <Stat label={c("quota.remaining")}>
                                {formatTraffic(quota.remaining)}
                              </Stat>
                              <Stat
                                size="sm"
                                label={`${c("used")} / ${c("quota.total")}`}
                              >
                                {formatTraffic(quota.used)} /{" "}
                                {formatTraffic(sub.total)}
                              </Stat>
                            </div>
                          </div>
                        ) : (
                          <p className="sub-quota-empty">
                            {c("quota.unknown")}
                          </p>
                        )}

                        <dl className="sub-meta-list">
                          {sub.expire > 0 && (
                            <div>
                              <dt>{c("expiry")}</dt>
                              <dd>
                                {new Date(sub.expire * 1000).toLocaleDateString(
                                  lang.replace("_", "-"),
                                )}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>{t("updated")}</dt>
                            <dd>
                              {sub.lastUpdated
                                ? new Date(
                                    sub.lastUpdated * 1000,
                                  ).toLocaleString(lang.replace("_", "-"))
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="sub-card-actions">
                        <Button
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              await updateSub(sub.id);
                              await refresh();
                            })
                          }
                        >
                          {t("updateBtn")}
                        </Button>
                        <ButtonSelect
                          value={sub.updateChannel || "direct"}
                          disabled={pending}
                          options={[
                            { label: t("channelDirect"), value: "direct" },
                            { label: t("channelSelf"), value: "self" },
                            { label: t("channelProxy"), value: "proxy" },
                          ]}
                          onSelect={(channel) =>
                            selectChannel(
                              sub.id,
                              channel as "direct" | "self" | "proxy",
                            )
                          }
                        />
                        <Button
                          disabled={pending}
                          onClick={() => rollback(sub.id)}
                        >
                          {t("rollback")}
                        </Button>
                        {sub.urlOrFile &&
                          /^https?:\/\//i.test(sub.urlOrFile) && (
                            <CopyButton
                              value={sub.urlOrFile}
                              label={c("copyLink")}
                            />
                          )}
                        <Button
                          disabled={pending}
                          onClick={() => {
                            setRenameId(sub.id);
                            setRenameValue(sub.name);
                          }}
                        >
                          {t("rename")}
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => void openOverride(sub.id)}
                        >
                          {t("override")}
                        </Button>
                        <Button
                          type="danger"
                          disabled={pending}
                          onClick={() => setRemoveId(sub.id)}
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="subscriptions-empty card">
                <p>{t("noSubs")}</p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="card subscriptions-readonly">
          <p>{t("readonly")}</p>
        </section>
      )}

      <Modal
        show={renameId !== null}
        title={t("rename")}
        okDisabled={!renameValue.trim() || Array.from(renameValue).length > 256}
        onClose={() => setRenameId(null)}
        pending={pending}
        onOk={() => {
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
        <label className="settings-rename-label">
          {t("namePlaceholder")}
          <Input value={renameValue} onChange={setRenameValue} align="left" />
        </label>
      </Modal>

      <Modal
        show={removeId !== null}
        title={t("remove")}
        onClose={() => setRemoveId(null)}
        pending={pending}
        onOk={() =>
          void run(async () => {
            if (removeId === activeId && status?.engine.running && localClient)
              await localClient.down();
            if (removeId) await removeSub(removeId);
            await refresh();
            setRemoveId(null);
          }, false)
        }
      >
        <p>{t("removeConfirm")}</p>
        {removeId === activeId && status?.engine.running && (
          <p className="setting-note mt-2 text-destructive">
            {t("removeActive")}
          </p>
        )}
      </Modal>

      <Modal
        show={proxyChannelId !== null}
        title={t("channelProxy")}
        onClose={() => setProxyChannelId(null)}
        okDisabled={!proxyChannelUrl.trim()}
        pending={pending}
        onOk={() => saveProxyChannel()}
      >
        <label className="settings-rename-label">
          {t("channelProxyUrl")}
          <Input
            value={proxyChannelUrl}
            onChange={setProxyChannelUrl}
            align="left"
            placeholder="http://127.0.0.1:7890"
          />
        </label>
        <p className="setting-note mt-2 text-muted-foreground">
          {t("channelProxyNote")}
        </p>
      </Modal>

      <Modal
        show={overrideId !== null}
        title={t("override")}
        onClose={() => setOverrideId(null)}
        pending={pending}
        onOk={() => void saveOverride()}
      >
        <div className="setting-label-col">
          <p className="text-sm text-muted-foreground">
            {t(
              subscriptions.find((sub) => sub.id === overrideId)?.format ===
                "sing-box"
                ? "overrideHintSingBox"
                : "overrideHintClash",
            )}
          </p>
          <label className="settings-rename-label">
            {t("overridePrepend")}
            <textarea
              className="subscriptions-override-textarea"
              rows={4}
              value={overridePrepend}
              onChange={(event) => setOverridePrepend(event.target.value)}
              placeholder={"DOMAIN-SUFFIX,corp.example,DIRECT"}
            />
          </label>
          <label className="settings-rename-label">
            {t("overrideAppend")}
            <textarea
              className="subscriptions-override-textarea"
              rows={4}
              value={overrideAppend}
              onChange={(event) => setOverrideAppend(event.target.value)}
              placeholder={"DOMAIN-SUFFIX,ads.example,REJECT"}
            />
          </label>
          <label className="settings-rename-label">
            {t("overrideDns")}
            <textarea
              className="subscriptions-override-textarea"
              rows={4}
              value={overrideDns}
              onChange={(event) => setOverrideDns(event.target.value)}
              placeholder={
                subscriptions.find((sub) => sub.id === overrideId)?.format ===
                "sing-box"
                  ? '{\n  "servers": [{ "tag": "dns-local", "address": "8.8.8.8" }]\n}'
                  : "nameserver:\n  - 8.8.8.8"
              }
            />
          </label>
          {overrideError && (
            <p role="alert" className="text-sm text-destructive">
              {overrideError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
