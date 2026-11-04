import { Header, Button } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { NativeSelect, NativeSelectOption } from "@components/ui/native-select";
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
import { useSearchParams } from "react-router-dom";

import { StrategyDirectory } from "../../components/Strategy";
import { Group, Provider } from "./components";
const SearchContext = createContext("");

function ProxyGroups() {
  const { groups, global } = useProxy();
  const search = useContext(SearchContext).toLowerCase();
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
    <section>
      <div className="section-heading mb-3.5">
        <h2>{t("groups")}</h2>
      </div>
      <label className="hidden max-md:mb-4 max-md:flex max-md:flex-col max-md:gap-2 max-md:text-body">
        {t("groups")}
        <NativeSelect
          wrapperClassName="w-full"
          className="min-h-11"
          value={selected.name}
          onChange={(event) => select(event.target.value)}
        >
          {list.map((group) => (
            <NativeSelectOption key={group.name} value={group.name}>
              {group.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <div className="grid grid-cols-[250px_minmax(0,1fr)] h-[calc(100vh-210px)] min-h-[460px] overflow-hidden rounded-card border border-border bg-card shadow-elevation-card max-md:flex max-md:flex-col max-md:h-auto">
        <StrategyDirectory
          label={t("groups")}
          value={selected.name}
          onSelect={select}
          items={list.map((group) => ({
            name: group.name,
            detail: group.now || "—",
            count: group.all.length,
            kind: group.type,
          }))}
        />
        <div className="min-w-0 h-full min-h-0 overflow-y-auto bg-card md:overflow-hidden">
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
      <div className="page gap-5 max-md:pb-[84px]">
        <Header title={t("title")} />
        <div className="rounded-card border border-border bg-card px-5 py-4 shadow-elevation-card">
          <div className="flex flex-wrap items-center justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3.5 max-md:w-full max-md:flex-col max-md:items-stretch max-md:gap-2.5">
              <div className="relative flex w-[260px] min-w-[180px] max-w-[320px] items-center max-md:w-full max-md:max-w-full">
                <svg
                  className="pointer-events-none absolute left-3 text-muted-foreground"
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
                  className="h-9 max-md:min-h-11 w-full rounded-sm border border-border bg-inset pr-8 pl-[34px] text-body text-foreground transition-all duration-150 focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand-soft focus:outline-none"
                  value={search}
                  placeholder={t("searchPlaceholder")}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("searchPlaceholder")}
                />
                {search && (
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-base leading-none text-muted-foreground hover:text-foreground max-md:size-11"
                    onClick={() => setSearch("")}
                    aria-label={tc("clear")}
                  >
                    &times;
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2.5 max-md:relative max-md:w-full max-md:justify-between">
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
                  <Button variant="outline" onClick={cancel}>
                    {t("cancelTest")}
                  </Button>
                )}
                {progress.total > 0 && (
                  <output className="rounded-control bg-inset px-2.5 py-1 text-label tabular-nums text-muted-foreground">
                    {t("progress")} {progress.completed}/{progress.total}
                  </output>
                )}
                <details className="relative">
                  <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-1.5 text-body text-muted-foreground transition-all duration-150 select-none hover:bg-inset hover:text-foreground">
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
                  <div className="absolute top-[calc(100%+8px)] left-0 z-20 flex min-w-[280px] flex-col gap-2.5 rounded-md border border-border bg-card px-4 py-3.5 shadow-[0_4px_12px_oklch(0_0_0/8%)] max-md:right-0 max-md:left-auto max-md:w-[calc(100vw-64px)] max-md:min-w-[240px] max-md:max-w-[320px]">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>{t("testUrl")}</span>
                      <input
                        className="h-8 rounded-control border border-border bg-inset px-2.5 text-label text-foreground"
                        value={data.testURL}
                        onChange={(e) => set("testURL", e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>{t("timeout")}</span>
                      <input
                        className="h-8 rounded-control border border-border bg-inset px-2.5 text-label text-foreground"
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

            <div className="ml-auto flex shrink-0 items-center max-md:ml-0 max-md:w-full">
              <div
                className="segmented-control max-md:flex max-md:w-full max-md:[&>button]:flex-1 max-md:[&>button]:px-1 max-md:[&>button]:py-2 max-md:[&>button]:text-center max-md:[&>button]:text-body max-md:[&>button]:whitespace-nowrap"
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
          <div className="flex items-center gap-[18px] py-8 text-sm text-muted-foreground">
            <p>{tc("empty")}</p>
            <Button onClick={() => setIdentity(false)}>{tc("edit")}</Button>
          </div>
        )}
        <ProxyGroups />
        <ProxyProviders />
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
