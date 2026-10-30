import { Modal, Input, Button, success } from "@components";
import { CopyButton } from "@components/CopyButton";
import { useAction } from "@lib/actions";
import { useObject } from "@lib/hook";
import {
  useAPIInfo,
  identityAtom,
  useControllers,
  useSelectController,
} from "@stores";
import {
  normalizeControllerURL,
  createControllerId,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSWRConfig } from "swr";

import "./style.scss";

export default function ExternalController() {
  const { t } = useTranslation("settings");
  const controller = useAPIInfo();
  const [identity, setIdentity] = useAtom(identityAtom);
  const [value, set] = useObject({ name: "", url: "", secret: "" });
  const [hosts, setter] = useControllers();
  const select = useSelectController();
  const { run, pending } = useAction();
  const { mutate } = useSWRConfig();
  // Browser-restriction help stays hidden until a connection test actually
  // fails, then surfaces as a "can't connect?" prompt with details on demand.
  const [testFailed, setTestFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [urlError, setUrlError] = useState<
    "" | "invalidURL" | "invalidPortRange"
  >("");
  // Every close path (save, remove, dismiss) routes through close() — the one
  // place transient test UI resets, so reopening the dialog starts clean.
  function close() {
    setTestFailed(false);
    setHelpOpen(false);
    setUrlError("");
    setIdentity(true);
  }
  useEffect(() => {
    set({
      name: controller.name,
      url: controller.url,
      secret: controller.secret,
    });
  }, [controller.name, controller.url, controller.secret, set]);

  function validated() {
    const text = value.url.trim();
    // Name the actual problem: an out-of-range port is by far the common case
    // and deserves its own message instead of a generic "invalid URL".
    const port = text.match(/:(\d+)(?:[/?#]|$)/);
    if (port && Number(port[1]) > 65535) {
      setUrlError("invalidPortRange");
      return null;
    }
    try {
      setUrlError("");
      return { ...value, url: normalizeControllerURL(text) };
    } catch {
      setUrlError("invalidURL");
      return null;
    }
  }
  function save(add = false) {
    const item = validated();
    if (!item) return;
    const id = add ? createControllerId() : controller.id;
    setter((current) => {
      const list = Array.isArray(current) ? current : hosts;
      return add
        ? [...list, { ...item, id }]
        : list.some((h) => h.id === id)
          ? list.map((h) => (h.id === id ? { ...item, id } : h))
          : [...list, { ...item, id }];
    });
    select(id);
    close();
    const client = Client.forController(item.url, item.secret);
    void mutate((key) => Array.isArray(key) && key[1] === client).catch(
      () => {},
    );
  }
  function remove() {
    const next = hosts.filter((h) => h.id !== controller.id);
    if (!next.length) return;
    setter(next);
    select(next[0].id);
    close();
  }
  async function test() {
    const item = validated();
    if (!item) return;
    setTestFailed(false);
    const ok = await run(async () => {
      await new Client(item.url, item.secret).getVersion();
      success(t("external.testOK"));
    }, false);
    if (!ok) setTestFailed(true);
  }
  // chrome:// and edge:// cannot be opened from page content; surface the
  // exact settings address for the current browser so it can be pasted into
  // the address bar. Local network access has no stable settings page, so it
  // stays as text guidance.
  const scheme = navigator.userAgent.includes("Edg/") ? "edge" : "chrome";
  const insecureURL = `${scheme}://settings/content/insecureContent`;
  return (
    <Modal
      className="external-controller-dialog !w-125 !max-w-[calc(100vw-32px)]"
      show={!identity}
      title={t("external.title")}
      bodyClassName="external-controller"
      onClose={() => close()}
      onOk={() => save()}
      pending={pending}
      footerExtra={
        <div className="flex gap-2">
          <Button disabled={pending} onClick={() => save(true)}>
            {t("external.add")}
          </Button>
          <Button
            type="danger"
            disabled={pending || hosts.length < 2}
            onClick={remove}
          >
            {t("external.delete")}
          </Button>
        </div>
      }
    >
      <p className="ec-note">{t("external.note")}</p>
      <div className="ec-form">
        <label className="ec-row">
          <span className="ec-label">{t("external.name")}</span>
          <Input
            aria-label={t("external.name")}
            align="left"
            value={value.name}
            onChange={(name) => set("name", name)}
          />
        </label>
        <label className="ec-row">
          <span className="ec-label">{t("external.url")}</span>
          <div className="ec-field-main">
            <Input
              aria-label={t("external.url")}
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? "ec-url-error" : undefined}
              align="left"
              value={value.url}
              placeholder="http://127.0.0.1:9090"
              onChange={(url) => {
                setUrlError("");
                set("url", url);
              }}
              onEnter={() => save()}
            />
            {urlError && (
              <p className="ec-error" id="ec-url-error" role="alert">
                {t(`external.${urlError}`)}
              </p>
            )}
          </div>
        </label>
        <label className="ec-row">
          <span className="ec-label">{t("external.secret")}</span>
          <div className="ec-secret">
            <Input
              aria-label={t("external.secret")}
              type="password"
              align="left"
              value={value.secret}
              onChange={(secret) => set("secret", secret)}
              onEnter={() => save()}
            />
            <Button className="ec-test" disabled={pending} onClick={test}>
              {pending ? t("external.connecting") : t("external.test")}
            </Button>
          </div>
        </label>
      </div>
      {testFailed && (
        <div className="ec-help">
          <button
            type="button"
            className="ec-help-trigger"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            {t("external.helpTrigger")}
            <svg
              className="ec-help-chevron"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {helpOpen && (
            <div className="ec-help-body">
              <p>{t("external.browserNote")}</p>
              <div className="ec-flag-row">
                <span className="ec-flag-label">
                  {t("external.allowInsecure")}
                </span>
                <code className="ec-flag">{insecureURL}</code>
                <CopyButton
                  value={insecureURL}
                  label={t("external.copyFlag")}
                />
              </div>
              <p className="ec-help-sub">{t("external.localNetworkNote")}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
