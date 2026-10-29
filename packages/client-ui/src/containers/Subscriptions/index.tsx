import {
  Header,
  Button,
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
  const track = params.get("track") === "universal" ? "universal" : "xbond";
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importFeedback, setImportFeedback] = useState<
    "idle" | "success" | "failed"
  >("idle");

  const link = (values: Record<string, string> = {}) =>
    workspaceLink(location.search, "/subscriptions", values);

  async function add() {
    setImportFeedback("idle");
    const ok = await run(async () => {
      await addSub({
        ...(track === "xbond"
          ? { token: token.trim() }
          : { urlOrFile: url.trim() }),
        name: name.trim() || undefined,
        lang: subscriptionLang(lang),
      });
      await refresh();
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
    </div>
  );
}
