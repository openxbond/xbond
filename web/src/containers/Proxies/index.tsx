import { Header, Icon, Checkbox, Input, Button } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { useRound } from "@lib/hook";
import {
  useI18n,
  useConfig,
  useProxy,
  useProxyProviders,
  useGeneral,
  useProxyMapping,
  identityAtom,
} from "@stores";
import { LatencyProvider, useLatency } from "@stores/latency";
import { useSetAtom } from "jotai";
import { useMemo, useState, createContext, useContext } from "react";

import "./style.scss";
import { useSearchParams } from "react-router-dom";

import { Proxy, Group, Provider } from "./components";
const SearchContext = createContext("");

enum sortType {
  None,
  Asc,
  Desc,
}

const sortMap = {
  [sortType.None]: "sort",
  [sortType.Asc]: "sort-ascending",
  [sortType.Desc]: "sort-descending",
};

import { compareDesc } from "@lib/latency";

export { compareDesc };

function ProxyGroups() {
  const { groups, global } = useProxy();
  const search = useContext(SearchContext).toLowerCase();
  const { data: config, set: setConfig } = useConfig();
  const { general } = useGeneral();
  const { translation } = useI18n();
  const { t } = translation("Proxies");
  const { t: ui } = translation("ClientUI");
  const [params, setParams] = useSearchParams();
  const list = useMemo(
    () =>
      (general.mode.toLowerCase() === "global"
        ? [global, ...groups]
        : groups
      ).filter(
        (group) =>
          !search ||
          [group.name, ...group.all].some((name) =>
            name.toLowerCase().includes(search),
          ),
      ),
    [general.mode, global, groups, search],
  );
  const selected =
    list.find((group) => group.name === params.get("group")) ?? list[0];
  const select = (name: string) =>
    setParams(
      (previous) => {
        previous.set("group", name);
        return previous;
      },
      { replace: true },
    );
  if (!list.length) return null;
  return (
    <section className="proxy-groups-section">
      <div className="section-heading">
        <h2>{ui("groups")}</h2>
        <Checkbox
          checked={config.breakConnections}
          onChange={(value) => setConfig("breakConnections", value)}
        >
          {t("breakConnectionsText")}
        </Checkbox>
      </div>
      <label className="mobile-group-picker">
        {ui("chooseGroup")}
        <select
          value={selected.name}
          onChange={(event) => select(event.target.value)}
        >
          {list.map((group) => (
            <option key={group.name} value={group.name}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <div className="proxy-workbench">
        <nav className="proxy-directory" aria-label={ui("groups")}>
          {list.map((group) => (
            <button
              type="button"
              key={group.name}
              aria-current={selected.name === group.name ? "true" : undefined}
              onClick={() => select(group.name)}
            >
              <strong>{group.name}</strong>
              <span>{group.now || "—"}</span>
              <small>
                {group.type} · {group.all.length} {ui("members")}
              </small>
            </button>
          ))}
        </nav>
        <div className="proxy-members">
          <Group
            key={selected.name}
            config={selected}
            search={search}
            initialOpen
          />
        </div>
      </div>
    </section>
  );
}

function ProxyProviders() {
  const search = useContext(SearchContext);
  const { providers, error, update } = useProxyProviders();
  const { translation: useTranslation } = useI18n();
  const { t } = useTranslation("Proxies");

  return (
    <>
      <RequestStatus error={error} retry={update} />
      {providers.length !== 0 && (
        <div className="flex flex-col">
          <Header title={t("providerTitle")} />
          <ul className="list-none">
            {providers
              .filter(
                (p) =>
                  !search ||
                  p.name.toLowerCase().includes(search.toLowerCase()) ||
                  p.proxies.some((node) =>
                    node.name.toLowerCase().includes(search.toLowerCase()),
                  ),
              )
              .map((p) => (
                <li className="my-2.5 md:my-4" key={p.name}>
                  <Provider
                    provider={p}
                    search={
                      p.name.toLowerCase().includes(search.toLowerCase())
                        ? ""
                        : search
                    }
                  />
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Proxies() {
  const { proxies } = useProxy();
  const mapping = useProxyMapping();
  const { results, run, progress } = useLatency();
  const { translation: useTranslation } = useI18n();
  const { t } = useTranslation("Proxies");

  const search = useContext(SearchContext).toLowerCase();
  const testNames = [...mapping.values()]
    .filter(
      (proxy) =>
        !("all" in proxy) &&
        !["Direct", "Reject", "DNS"].includes(proxy.type) &&
        (!search || proxy.name.toLowerCase().includes(search)),
    )
    .map((proxy) => proxy.name);

  const { current: sort, next } = useRound([
    sortType.Asc,
    sortType.Desc,
    sortType.None,
  ]);
  const sortedProxies = useMemo(() => {
    switch (sort) {
      case sortType.Desc:
        return proxies.slice().sort((a, b) => compareDesc(a, b, results));
      case sortType.Asc:
        return proxies.slice().sort((a, b) => -1 * compareDesc(a, b, results));
      default:
        return proxies.slice();
    }
  }, [sort, proxies, results]);
  const handleSort = next;

  return (
    <>
      {sortedProxies.length !== 0 && (
        <div className="flex flex-col">
          <Header title={t("title")}>
            <Icon
              className="ml-3"
              type={sortMap[sort]}
              onClick={handleSort}
              size={20}
            />
            <button
              type="button"
              className="proxies-speed-test ml-3 inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={progress.running || !testNames.length}
              onClick={() => {
                void run(testNames);
              }}
            >
              <span aria-hidden="true">
                <Icon type="speed" size={20} />
              </span>
              {t("speedTestText")}
            </button>
          </Header>
          <ul className="proxies-list">
            {sortedProxies
              .filter((p) => !search || p.name.toLowerCase().includes(search))
              .map((p) => (
                <li key={p.name}>
                  <Proxy config={p} />
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ProxyPage() {
  const [search, setSearch] = useState("");
  const { data, set } = useConfig();
  const { translation } = useI18n();
  const { t } = translation("Speed");
  const { t: r } = translation("Runtime");
  const { t: ui } = translation("ClientUI");
  const { run, cancel, progress } = useLatency();
  const mapping = useProxyMapping();
  const { error, update } = useProxy();
  const setIdentity = useSetAtom(identityAtom);
  const names = [...mapping.values()]
    .filter(
      (proxy) =>
        !("all" in proxy) &&
        !["Direct", "Reject", "DNS"].includes(proxy.type) &&
        (!search || proxy.name.toLowerCase().includes(search.toLowerCase())),
    )
    .map((proxy) => proxy.name);
  return (
    <SearchContext value={search}>
      <div className="page proxies-page">
        <Header title={ui("proxies")}>
          <Button onClick={() => setIdentity(false)}>{r("edit")}</Button>
        </Header>
        <div className="proxy-command-bar">
          <label className="proxy-search">
            {t("search")}
            <Input
              value={search}
              align="left"
              onChange={setSearch}
              aria-label={t("search")}
            />
          </label>
          <Button
            disabled={!names.length || progress.running}
            onClick={() => void run(names)}
          >
            {t("start")}
          </Button>
          {progress.running && <Button onClick={cancel}>{t("cancel")}</Button>}
          {progress.total > 0 && (
            <output>
              {t("progress")} {progress.completed}/{progress.total}
            </output>
          )}
          <details className="speed-options">
            <summary>{ui("parameters")}</summary>
            <div>
              <label>
                {t("target")}
                <Input
                  value={data.testURL}
                  align="left"
                  onChange={(value) => set("testURL", value)}
                />
              </label>
              <label>
                {t("timeout")}
                <Input
                  value={data.testTimeout}
                  type="number"
                  min={100}
                  max={30000}
                  onChange={(value) => set("testTimeout", Number(value))}
                />
              </label>
            </div>
          </details>
        </div>
        <RequestStatus error={error} retry={update} />
        {!mapping.size && (
          <div className="proxy-empty">
            <p>{r("empty")}</p>
            <Button onClick={() => setIdentity(false)}>{r("edit")}</Button>
          </div>
        )}
        <ProxyGroups />
        <ProxyProviders />
        <Proxies />
        {search &&
          ![...mapping.keys()].some((name) =>
            name.toLowerCase().includes(search.toLowerCase()),
          ) && <p className="py-8 text-muted-foreground">{r("empty")}</p>}
      </div>
    </SearchContext>
  );
}

export default function ProxyContainer() {
  return (
    <LatencyProvider>
      <ProxyPage />
    </LatencyProvider>
  );
}
