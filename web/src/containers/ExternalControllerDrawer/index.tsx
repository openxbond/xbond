import { Modal, Input, Alert, Button, error, success } from "@components";
import { useAction } from "@lib/actions";
import { normalizeControllerURL, createControllerId } from "@lib/controller";
import { useObject } from "@lib/hook";
import { Client } from "@lib/request";
import {
  useI18n,
  useAPIInfo,
  identityAtom,
  useControllers,
  useSelectController,
} from "@stores";
import { useAtom } from "jotai";
import { useEffect } from "react";
import { useSWRConfig } from "swr";

import "./style.scss";

export default function ExternalController() {
  const { translation } = useI18n();
  const { t } = translation("Settings");
  const { t: r } = translation("Runtime");
  const controller = useAPIInfo();
  const [identity, setIdentity] = useAtom(identityAtom);
  const [value, set] = useObject({ name: "", url: "", secret: "" });
  const [hosts, setter] = useControllers();
  const select = useSelectController();
  const { run, pending } = useAction();
  const { mutate } = useSWRConfig();
  useEffect(() => {
    set({
      name: controller.name,
      url: controller.url,
      secret: controller.secret,
    });
  }, [controller.name, controller.url, controller.secret, set]);

  function validated() {
    try {
      return { ...value, url: normalizeControllerURL(value.url.trim()) };
    } catch {
      error(r("invalidURL"));
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
    setIdentity(true);
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
    setIdentity(true);
  }
  function test() {
    const item = validated();
    if (!item) return;
    void run(async () => {
      await new Client(item.url, item.secret).getVersion();
      success(r("testOK"));
    }, false);
  }
  return (
    <Modal
      className="!w-125 !max-w-[calc(100vw-32px)]"
      show={!identity}
      title={t("externalControllerSetting.title")}
      bodyClassName="external-controller"
      onClose={() => setIdentity(true)}
      onOk={() => save()}
      pending={pending}
      footerExtra={
        <div className="flex gap-2">
          <Button disabled={pending} onClick={() => save(true)}>
            {t("externalControllerSetting.addText")}
          </Button>
          <Button
            type="danger"
            disabled={pending || hosts.length < 2}
            onClick={remove}
          >
            {t("externalControllerSetting.deleteText")}
          </Button>
        </div>
      }
    >
      <Alert type="info" inside>
        <p>{t("externalControllerSetting.note")}</p>
      </Alert>
      <div className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          {r("name")}
          <Input
            aria-label={r("name")}
            align="left"
            value={value.name}
            onChange={(name) => set("name", name)}
          />
        </label>
        <label className="flex flex-col gap-2">
          {r("url")}
          <Input
            aria-label={r("url")}
            align="left"
            value={value.url}
            placeholder="http://127.0.0.1:9090"
            onChange={(url) => set("url", url)}
            onEnter={() => save()}
          />
        </label>
        <label className="flex flex-col gap-2">
          {t("externalControllerSetting.secret")}
          <Input
            aria-label={t("externalControllerSetting.secret")}
            type="password"
            align="left"
            value={value.secret}
            onChange={(secret) => set("secret", secret)}
            onEnter={() => save()}
          />
        </label>
        <div>
          <Button disabled={pending} onClick={test}>
            {pending ? r("connecting") : r("test")}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground break-words">
          {r("privateNetwork")}
        </p>
      </div>
    </Modal>
  );
}
