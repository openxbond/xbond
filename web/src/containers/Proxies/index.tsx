import { Header, Icon, Checkbox, Button, renderNodeTitle } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { useRound } from "@lib/hook";
import {
  useConfig,
  useProxy,
  useProxyProviders,
  useGeneral,
  useProxyMapping,
  identityAtom,
  useClient,
  useLocalAPI,
} from "@stores";
import { LatencyProvider, useLatency } from "@stores/latency";
import { useSetAtom } from "jotai";
import { useMemo, useState, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("proxies");
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
        <h2>{t("groups")}</h2>
        <Checkbox
          checked={config.breakConnections}
          onChange={(value) => setConfig("breakConnections", value)}
        >
          {t("breakConnections")}
        </Checkbox>
      </div>
      <label className="mobile-group-picker">
        {t("groups")}
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
        <nav className="proxy-directory" aria-label={t("groups")}>
          {list.map((group) => (
            <button
              type="button"
              key={group.name}
              className={`proxy-dir-item ${selected.name === group.name ? "is-active" : ""}`}
              aria-label={group.name}
              aria-current={selected.name === group.name ? "true" : undefined}
              onClick={() => select(group.name)}
            >
              <div className="dir-item-top">
                <strong className="dir-item-name">{group.name}</strong>
                <span className="dir-item-badge">{group.type}</span>
              </div>
              <div className="dir-item-bottom">
                <span className="dir-item-now" title={group.now || "—"}>
                  {group.now ? renderNodeTitle(group.now) : "—"}
                </span>
                <span className="dir-item-count">{group.all.length}</span>
              </div>
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
  const { t } = useTranslation("proxies");

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
  const { t } = useTranslation("proxies");

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
              {t("speedTest")}
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
  const { t } = useTranslation("proxies");
  const { t: tc } = useTranslation("common");
  const { run, cancel, progress } = useLatency();
  const mapping = useProxyMapping();
  const { error, update } = useProxy();
  const { general, update: updateGeneral } = useGeneral();
  const { hasLocalAPI, status, setMode } = useLocalAPI();
  const client = useClient();
  const setIdentity = useSetAtom(identityAtom);

  const currentRouting =
    (hasLocalAPI
      ? status?.preferences.routingMode
      : general.mode
    )?.toLowerCase() || "rule";

  const switchRouting = async (mode: "rule" | "global" | "direct") => {
    if (hasLocalAPI) {
      await setMode({ routing: mode });
    } else {
      await client.updateConfig({ mode });
      await updateGeneral();
    }
  };

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
        <Header title={t("title")} />
        <div className="proxy-command-card">
          <div className="command-card-main">
            <div className="command-card-left">
              <div className="proxy-search-wrapper">
                <svg
                  className="search-icon"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  className="search-input"
                  value={search}
                  placeholder={t("searchPlaceholder")}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("searchPlaceholder")}
                />
                {search && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => setSearch("")}
                    aria-label={tc("clear")}
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className="command-card-actions">
                <Button
                  disabled={!names.length || progress.running}
                  onClick={() => void run(names)}
                >
                  <span className="flex items-center gap-1.5">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    {t("start")}
                  </span>
                </Button>
                {progress.running && (
                  <Button onClick={cancel}>{t("cancelTest")}</Button>
                )}
                {progress.total > 0 && (
                  <output className="speed-progress-badge">
                    {t("progress")} {progress.completed}/{progress.total}
                  </output>
                )}
                <details className="speed-options-dropdown">
                  <summary className="speed-options-summary">
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    {t("parameters")}
                  </summary>
                  <div className="speed-options-drawer">
                    <label className="speed-option-field">
                      <span>{t("testUrl")}</span>
                      <input
                        className="speed-input"
                        value={data.testURL}
                        onChange={(e) => set("testURL", e.target.value)}
                      />
                    </label>
                    <label className="speed-option-field">
                      <span>{t("timeout")}</span>
                      <input
                        className="speed-input speed-timeout-input"
                        value={data.testTimeout}
                        type="number"
                        min={100}
                        max={30000}
                        onChange={(e) =>
                          set("testTimeout", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                </details>
              </div>
            </div>

            <div className="command-card-right">
              <div
                className="segmented-control"
                aria-label={tc("routingMode.title")}
              >
                {(["rule", "global", "direct"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={currentRouting === mode}
                    onClick={() => void switchRouting(mode)}
                  >
                    {tc(`routingMode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <RequestStatus error={error} retry={update} />
        {!mapping.size && (
          <div className="proxy-empty">
            <p>{tc("empty")}</p>
            <Button onClick={() => setIdentity(false)}>{tc("edit")}</Button>
          </div>
        )}
        <ProxyGroups />
        <ProxyProviders />
        <Proxies />
        {search &&
          ![...mapping.keys()].some((name) =>
            name.toLowerCase().includes(search.toLowerCase()),
          ) && <p className="py-8 text-muted-foreground">{tc("empty")}</p>}
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
