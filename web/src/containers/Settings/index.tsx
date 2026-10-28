import {
  Header,
  Button,
  ButtonSelect,
  Input,
  Switch,
  Modal,
} from "@components";
import { RequestStatus } from "@components/RequestStatus";
import Diagnostics from "@containers/Diagnostics";
import Rules from "@containers/Rules";
import type { Lang } from "@i18n";
import { useAction } from "@lib/actions";
import { validPort } from "@lib/controller";
import { formatTraffic } from "@lib/helper";
import { DASHBOARD_VERSION } from "@lib/version";
import { workspaceLink } from "@lib/workspace";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useGeneral,
  useI18n,
  useLocalAPI,
  useSubscriptions,
  useVersion,
  useControllers,
  useSelectController,
  selectedControllerAtom,
  identityAtom,
  themeAtom,
  type ThemePreference,
} from "@stores";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import "./style.scss";

const sections = [
  "general",
  "configuration",
  "network",
  "rules",
  "diagnostics",
] as const;
export default function Settings() {
  const { translation, lang, setLang } = useI18n();
  const { t } = translation("Settings");
  const { t: ui } = translation("ClientUI");
  const { t: r } = translation("Runtime");
  const location = useLocation();
  const [params] = useSearchParams();
  const selected = params.get("section");
  const section = sections.find((item) => item === selected) ?? "general";
  const controller = useAPIInfo();
  const [controllers] = useControllers();
  const selectedController = useAtomValue(selectedControllerAtom);
  const selectController = useSelectController();
  const caps = useCapabilities();
  const version = useVersion();
  const client = useClient();
  const { general, update, error } = useGeneral();
  const {
    hasLocalAPI,
    isLocalTarget,
    status,
    setMode,
    client: localClient,
    refresh,
  } = useLocalAPI();
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
  const [theme, setTheme] = useAtom(themeAtom);
  const setIdentity = useSetAtom(identityAtom);
  const { run, pending } = useAction();
  const [port, setPort] = useState("");
  const [validation, setValidation] = useState("");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const track = params.get("track") === "universal" ? "universal" : "xbond";
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [report, setReport] = useState<unknown>(null);
  const link = (values: Record<string, string> = {}) =>
    workspaceLink(location.search, "/settings", values);
  async function add() {
    const ok = await run(async () => {
      await addSub({
        ...(track === "xbond"
          ? { token: token.trim() }
          : { urlOrFile: url.trim() }),
        name: name.trim() || undefined,
        lang: lang.replace("_", "-"),
      });
      await refresh();
    });
    if (ok) {
      setToken("");
      setUrl("");
      setName("");
    }
  }
  async function savePort() {
    if (!validPort(port)) {
      setValidation(r("invalidPort"));
      return;
    }
    setValidation("");
    await run(async () => {
      if (hasLocalAPI) await setMode({ port: Number(port) });
      else {
        await client.updateConfig({ "mixed-port": Number(port) });
        await update();
      }
    });
  }
  return (
    <div className="page settings-page">
      <Header title={t("title")} />
      <section className="settings-identity" aria-label={ui("environment")}>
        <div>
          <span>{ui("environment")}</span>
          <strong>{isLocalTarget ? ui("local") : ui("remote")}</strong>
        </div>
        <div>
          <span>{ui("controller")}</span>
          <strong>{controller.name || new URL(controller.url).hostname}</strong>
        </div>
        <div>
          <span>{ui("core")}</span>
          <strong>{version.version || "—"}</strong>
        </div>
        <div>
          <span>XBond</span>
          <strong>{DASHBOARD_VERSION}</strong>
        </div>
      </section>
      <div className="settings-layout">
        <nav className="settings-directory" aria-label={t("title")}>
          {sections.map((item) => (
            <Link
              key={item}
              to={link({ section: item })}
              aria-current={section === item ? "page" : undefined}
            >
              {ui(item)}
            </Link>
          ))}
        </nav>
        <section
          className={"settings-detail" + (!selected ? " settings-default" : "")}
        >
          <Link className="settings-back section-link" to={link()}>
            {ui("back")}
          </Link>
          <h2 className="settings-section-title">{ui(section)}</h2>
          {section === "general" && (
            <div className="settings-sheet">
              <h3>{ui("preferences")}</h3>
              <div className="setting-row">
                <span>{t("labels.language")}</span>
                <ButtonSelect
                  value={lang}
                  options={[
                    { value: "zh_HK", label: "繁體中文（香港）" },
                    { value: "zh_CN", label: "简体中文" },
                    { value: "en_US", label: "English" },
                  ]}
                  onSelect={(value) => setLang(value as Lang)}
                />
              </div>
              <div className="setting-row">
                <span>{t("labels.theme")}</span>
                <ButtonSelect<ThemePreference>
                  value={theme ?? "system"}
                  options={[
                    { value: "system", label: t("values.system") },
                    { value: "light", label: t("values.light") },
                    { value: "dark", label: t("values.dark") },
                  ]}
                  onSelect={setTheme}
                />
              </div>
            </div>
          )}
          {section === "configuration" && (
            <>
              <div className="settings-sheet">
                <div className="section-heading">
                  <h3>{ui("controller")}</h3>
                  <Button onClick={() => setIdentity(false)}>
                    {r("edit")}
                  </Button>
                </div>
                <p className="setting-note">
                  <label className="controller-picker">
                    {ui("controller")}
                    <select
                      value={selectedController}
                      onChange={(event) => selectController(event.target.value)}
                    >
                      {controllers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name || new URL(item.url).hostname}
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasLocalAPI
                    ? controller.name || ui("local")
                    : ui("remoteNote")}
                </p>
              </div>
              {hasLocalAPI ? (
                <div className="settings-sheet">
                  <div className="settings-track">
                    <Link
                      to={link({ section: "configuration", track: "xbond" })}
                      aria-current={track === "xbond" ? "page" : undefined}
                    >
                      {ui("bind")}
                    </Link>
                    <Link
                      to={link({
                        section: "configuration",
                        track: "universal",
                      })}
                      aria-current={track === "universal" ? "page" : undefined}
                    >
                      {ui("import")}
                    </Link>
                  </div>
                  {track === "xbond" && (
                    <p className="setting-note">{ui("bindNote")}</p>
                  )}
                  <form
                    className="settings-import"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void add();
                    }}
                  >
                    <label>
                      {track === "xbond"
                        ? t("subs.xbondTrack")
                        : t("subs.universalTrack")}
                      <Input
                        type={track === "xbond" ? "password" : "text"}
                        value={track === "xbond" ? token : url}
                        onChange={track === "xbond" ? setToken : setUrl}
                        placeholder={
                          track === "xbond"
                            ? t("subs.tokenPlaceholder")
                            : t("subs.urlPlaceholder")
                        }
                        align="left"
                      />
                    </label>
                    <label>
                      {t("subs.namePlaceholder")}
                      <Input value={name} onChange={setName} align="left" />
                    </label>
                    <button
                      type="submit"
                      className="button"
                      disabled={
                        pending || !(track === "xbond" ? token : url).trim()
                      }
                    >
                      {pending ? r("loading") : t("subs.addBtn")}
                    </button>
                  </form>
                  <RequestStatus error={subError} retry={refreshSubs} />
                  <div className="subscription-list">
                    {subscriptions.length ? (
                      subscriptions.map((sub) => (
                        <article className="subscription-row" key={sub.id}>
                          <div className="subscription-meta">
                            <strong>{sub.name}</strong>
                            <span>
                              {sub.type === "xbond"
                                ? "XBond"
                                : t("subs.universalTrack")}
                              {sub.id === activeId
                                ? " · " + t("subs.active")
                                : ""}
                            </span>
                            {sub.total > 0 && (
                              <span>
                                {formatTraffic(sub.upload + sub.download)} /{" "}
                                {formatTraffic(sub.total)}
                              </span>
                            )}
                            {sub.expire > 0 && (
                              <span>
                                {ui("expiry")} ·{" "}
                                {new Date(sub.expire * 1000).toLocaleDateString(
                                  lang.replace("_", "-"),
                                )}
                              </span>
                            )}
                            <span>
                              {ui("updated")} ·{" "}
                              {sub.lastUpdated
                                ? new Date(
                                    sub.lastUpdated * 1000,
                                  ).toLocaleString(lang.replace("_", "-"))
                                : "—"}
                            </span>
                          </div>
                          <div className="subscription-actions">
                            <Button
                              disabled={pending}
                              onClick={() => {
                                setRenameId(sub.id);
                                setRenameValue(sub.name);
                              }}
                            >
                              {ui("rename")}
                            </Button>
                            <Button
                              disabled={pending || sub.id === activeId}
                              onClick={() =>
                                void run(async () => {
                                  await selectSub(sub.id);
                                  await refresh();
                                })
                              }
                            >
                              {ui("use")}
                            </Button>
                            <Button
                              disabled={pending}
                              onClick={() =>
                                void run(async () => {
                                  await updateSub(sub.id);
                                  await refresh();
                                })
                              }
                            >
                              {t("subs.updateBtn")}
                            </Button>
                            <Button
                              type="danger"
                              disabled={pending}
                              onClick={() => setRemoveId(sub.id)}
                            >
                              {ui("remove")}
                            </Button>
                          </div>
                          <details className="subscription-details">
                            <summary>{ui("details")}</summary>
                            <dl className="home-facts">
                              <div>
                                <dt>{t("subs.namePlaceholder")}</dt>
                                <dd>{sub.name}</dd>
                              </div>
                              <div>
                                <dt>{ui("source")}</dt>
                                <dd>
                                  {sub.type === "xbond"
                                    ? "XBond"
                                    : t("subs.universalTrack")}
                                </dd>
                              </div>
                              <div>
                                <dt>{ui("updateInterval")}</dt>
                                <dd>
                                  {sub.updateIntervalHours} {ui("hours")}
                                </dd>
                              </div>
                            </dl>
                          </details>
                        </article>
                      ))
                    ) : (
                      <p className="setting-note">{t("subs.noSubs")}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="setting-note">{ui("readonly")}</p>
              )}
            </>
          )}
          {section === "network" && (
            <div className="settings-sheet">
              <RequestStatus error={error} retry={update} />
              {hasLocalAPI ? (
                <>
                  <h3>{ui("control")}</h3>
                  <div className="takeover-options">
                    {(["sysproxy", "tun", "port"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={status?.preferences.takeoverMode === mode}
                        disabled={pending}
                        onClick={() => void run(() => setMode({ mode }))}
                      >
                        <strong>{ui(mode)}</strong>
                        <span>
                          {t(
                            ("takeover." + mode + "Desc") as
                              | "takeover.sysproxyDesc"
                              | "takeover.tunDesc"
                              | "takeover.portDesc",
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="setting-note">{r("readonly")}</p>
              )}
              <div className="setting-row">
                <label htmlFor="mixed-port">{t("takeover.mixedPort")}</label>
                <div className="setting-inline">
                  <input
                    id="mixed-port"
                    aria-label={t("takeover.mixedPort")}
                    type="number"
                    min="0"
                    max="65535"
                    value={
                      port ||
                      String(
                        status?.preferences.mixedPort ??
                          general.mixedPort ??
                          "",
                      )
                    }
                    onChange={(e) => setPort(e.target.value)}
                    disabled={
                      pending ||
                      (isLocalTarget && !hasLocalAPI) ||
                      (!hasLocalAPI && !caps.editPorts)
                    }
                  />
                  <Button
                    disabled={
                      pending ||
                      !port ||
                      (isLocalTarget && !hasLocalAPI) ||
                      (!hasLocalAPI && !caps.editPorts)
                    }
                    onClick={() => void savePort()}
                  >
                    {ui("confirm")}
                  </Button>
                </div>
              </div>
              {validation && (
                <p role="alert" className="client-message">
                  {validation}
                </p>
              )}
              <div className="setting-row">
                <span>{t("takeover.allowLan")}</span>
                <Switch
                  checked={status?.preferences.allowLan ?? general.allowLan}
                  disabled={
                    pending ||
                    (isLocalTarget && !hasLocalAPI) ||
                    (!hasLocalAPI && !caps.editLan)
                  }
                  onChange={(allowLan) =>
                    void run(async () => {
                      if (hasLocalAPI) await setMode({ allowLan });
                      else {
                        await client.updateConfig({ "allow-lan": allowLan });
                        await update();
                      }
                    })
                  }
                />
              </div>
            </div>
          )}
          {section === "rules" && (
            <>
              <Rules />
              <Diagnostics />
            </>
          )}
          {section === "diagnostics" && (
            <div className="settings-sheet">
              <h3>{t("doctor.title")}</h3>
              <div className="settings-actions">
                <Button
                  disabled={!localClient || pending}
                  onClick={() =>
                    void run(async () => {
                      setReport(null);
                      setReport(await localClient!.runDoctor());
                    }, false)
                  }
                >
                  {pending ? t("doctor.running") : t("doctor.runBtn")}
                </Button>
                <Button
                  disabled={!localClient || pending}
                  onClick={() =>
                    void run(async () => {
                      const result = await localClient!.getBugReport();
                      const objectURL = URL.createObjectURL(
                        new Blob([JSON.stringify(result, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = objectURL;
                      a.download = "xbond-bugreport.json";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
                    }, false)
                  }
                >
                  {t("doctor.exportBugreport")}
                </Button>
              </div>
              {!hasLocalAPI && <p className="setting-note">{ui("readonly")}</p>}
              {report !== null && (
                <pre className="doctor-report" aria-label={ui("tests")}>
                  {JSON.stringify(report, null, 2)}
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
      <Modal
        show={renameId !== null}
        title={ui("rename")}
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
          {t("subs.namePlaceholder")}
          <Input value={renameValue} onChange={setRenameValue} align="left" />
        </label>
      </Modal>
      <Modal
        show={removeId !== null}
        title={ui("remove")}
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
        {ui("removeConfirm")}
        {removeId === activeId && status?.engine.running && (
          <p className="setting-note">{ui("removeActive")}</p>
        )}
      </Modal>
    </div>
  );
}
