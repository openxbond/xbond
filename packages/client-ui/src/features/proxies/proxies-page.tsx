import { compareDesc } from "@xbond/client/latency";
import { ArrowUpDown, Search, SlidersHorizontal, X, Zap } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { renderNodeTitle } from "@/components/country-flag";
import {
  DisconnectedState,
  useIsServiceConnected,
} from "@/components/disconnected-state";
import { Header } from "@/components/page-header";
import { StrategyDirectory } from "@/components/proxy-strategy";
import { RequestStatus } from "@/components/request-status";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorKind } from "@/hooks/use-action";
import { useIsMobile } from "@/platform/host";
import { useClient } from "@/state/controller-target";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";
import { useConfig } from "@/state/user-preferences";

import { useLatency } from "./latency-context";
import { useProxy, useProxyMapping, useProxyProviders } from "./proxy-data";
import { Group } from "./proxy-group-panel";
import { Provider } from "./proxy-provider-card";
import { Proxy } from "./proxy-row";

const SearchContext = createContext("");

function resolveLeaf(
  name: string,
  mapping: Map<string, unknown>,
  seen = new Set<string>(),
): string {
  if (!name || seen.has(name)) return name;
  seen.add(name);
  const item = mapping.get(name);
  if (
    item &&
    typeof item === "object" &&
    "now" in item &&
    typeof item.now === "string" &&
    item.now &&
    item.now !== name
  ) {
    return resolveLeaf(item.now, mapping, seen);
  }
  return name;
}

function ProxyGroups() {
  const { groups, global } = useProxy();
  const mapping = useProxyMapping();
  const search = useContext(SearchContext).toLowerCase();
  const { general } = useGeneral();
  const { t } = useTranslation("proxies");
  const [params, setParams] = useSearchParams();

  const resolveLeafNode = useCallback(
    function findLeaf(name: string): string {
      return resolveLeaf(name, mapping);
    },
    [mapping],
  );

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
        const next = new URLSearchParams(previous);
        next.set("group", name);
        return next;
      },
      { replace: true },
    );
  if (!list.length) return null;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {/* 手機：策略組切換下拉菜單 */}
      {list.length > 1 && (
        <div className="mb-3 lg:hidden">
          <Select value={selected.name} onValueChange={select}>
            <SelectTrigger
              className="h-10 sm:h-11 w-full justify-between rounded-xl border border-border/80 bg-card/90 px-3 py-2 text-xs shadow-2xs transition-colors hover:border-brand/40 hover:bg-card focus:border-brand"
              aria-label={t("groups")}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5 pe-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {t("groups")}:
                  </span>
                  <span className="truncate text-xs font-semibold text-foreground">
                    {renderNodeTitle(selected.name)}
                  </span>
                  {selected.type && (
                    <span className="shrink-0 rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                      {selected.type}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  {selected.now && (
                    <span className="hidden sm:inline-block max-w-[140px] truncate text-muted-foreground/80">
                      {renderNodeTitle(
                        resolveLeafNode(selected.now) || selected.now,
                      )}
                    </span>
                  )}
                  {selected.now && (
                    <span className="hidden sm:inline text-muted-foreground/40">
                      ·
                    </span>
                  )}
                  <span className="font-mono tabular-nums">
                    {t("groupMembers", { count: selected.all.length })}
                  </span>
                </div>
              </div>
            </SelectTrigger>
            <SelectContent
              position="popper"
              sideOffset={4}
              className="z-50 max-h-80 w-[var(--radix-select-trigger-width)] p-1.5"
            >
              <SelectGroup>
                {list.map((group) => {
                  const leafNode =
                    resolveLeafNode(group.now || "") || group.now;
                  return (
                    <SelectItem
                      key={group.name}
                      value={group.name}
                      className="py-2 px-2.5 text-xs rounded-lg cursor-pointer"
                    >
                      <div className="flex w-full min-w-0 flex-col gap-0.5">
                        <div className="flex w-full min-w-0 items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-semibold text-foreground text-xs">
                              {renderNodeTitle(group.name)}
                            </span>
                            {group.type && (
                              <span className="shrink-0 rounded border border-border/60 bg-muted/60 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
                                {group.type}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/75">
                            {t("groupMembers", { count: group.all.length })}
                          </span>
                        </div>
                        {leafNode && (
                          <div className="flex w-full min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="min-w-0 truncate text-muted-foreground/90">
                              {renderNodeTitle(leafNode)}
                            </span>
                          </div>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
      {/* flex chain fills the workspace height instead of a 100vh magic
          number, so the panel edge lands exactly on the page bottom. */}
      <div className="bento flex min-h-[480px] flex-col overflow-hidden p-0 shadow-elevation-card lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[270px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)]">
        <StrategyDirectory
          className="hidden lg:flex"
          label={t("groups")}
          value={selected.name}
          onSelect={select}
          items={list.map((group) => ({
            name: group.name,
            detail: resolveLeafNode(group.now || "") || group.now || "—",
            count: group.all.length,
            kind: group.type,
          }))}
        />
        <div className="min-w-0 h-full min-h-0 overflow-y-auto bg-card lg:overflow-hidden">
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

  const [sort, setSort] = useState<"default" | "latency" | "name">("default");

  const testNames = useMemo(
    () =>
      [...mapping.values()]
        .filter(
          (proxy) =>
            !("all" in proxy) &&
            !["Direct", "Reject", "DNS"].includes(proxy.type) &&
            (!search || proxy.name.toLowerCase().includes(search)),
        )
        .map((proxy) => proxy.name),
    [mapping, search],
  );

  const sortedProxies = useMemo(() => {
    const list = proxies.filter(
      (p) => !search || p.name.toLowerCase().includes(search),
    );
    if (sort === "name") {
      return list.slice().sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sort === "latency") {
      return list.slice().sort((a, b) => -1 * compareDesc(a, b, results));
    }
    return list;
  }, [sort, proxies, results, search]);

  if (!sortedProxies.length) return null;

  const cycleSort = () => {
    setSort((current) =>
      current === "default"
        ? "latency"
        : current === "latency"
          ? "name"
          : "default",
    );
  };

  const sortLabel =
    sort === "latency"
      ? t("sortLatency")
      : sort === "name"
        ? t("sortName")
        : t("sortDefault");

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-body font-bold text-foreground">{t("nodes")}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("sortState", { mode: sortLabel })}
            className="text-muted-foreground hover:text-foreground h-8 text-xs cursor-pointer"
            onClick={cycleSort}
          >
            <ArrowUpDown className="mr-1.5 size-3.5" />
            <span>{sortLabel}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-brand-text hover:text-brand-text h-8 text-xs cursor-pointer"
            disabled={progress.running || !testNames.length}
            onClick={() => {
              void run(testNames);
            }}
          >
            <Zap className="mr-1.5 size-3.5" />
            <span>{t("speedTest")}</span>
          </Button>
        </div>
      </div>
      <ul className="mb-10 grid list-none grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3 p-0 max-md:grid-cols-1">
        {sortedProxies.map((p) => (
          <li key={p.name}>
            <Proxy config={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProxyPage() {
  const [search, setSearch] = useState("");
  const isMobile = useIsMobile();
  const { data, set } = useConfig();
  const { t } = useTranslation("proxies");
  const { t: tc } = useTranslation("common");
  const { t: r } = useTranslation("runtime");
  const { cancel, progress } = useLatency();
  const mapping = useProxyMapping();
  const { error, update, isLoading } = useProxy();
  const { general, update: updateGeneral } = useGeneral();
  const { hasLocalAPI, status, setMode } = useLocalAPI();
  const { isConnected, hasSub } = useIsServiceConnected();
  const client = useClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const currentTab = params.get("tab") === "nodes" ? "nodes" : "groups";
  const handleTabChange = (val: string) => {
    setParams(
      (previous) => {
        previous.set("tab", val);
        return previous;
      },
      { replace: true },
    );
  };

  // 樂觀顯示 + 失敗回退：void 掉的 async 不捕獲會變成無回應的
  // unhandled rejection；進行中鎖住分段控件，防止連點競態。
  const [optimisticRouting, setOptimisticRouting] = useState<
    "rule" | "global" | "direct" | null
  >(null);
  const switchingRouting = optimisticRouting !== null;

  const configuredRouting = (
    hasLocalAPI ? status?.preferences.routingMode : general.mode
  )?.toLowerCase();
  const currentRouting = optimisticRouting ?? configuredRouting ?? "rule";

  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: tc(`routingMode.${mode}`),
    }),
  );
  const routingValue = routingOptions.find(
    (option) => option.value === currentRouting,
  )?.value;

  const switchRouting = async (mode: "rule" | "global" | "direct") => {
    if (switchingRouting) return;
    setOptimisticRouting(mode);
    try {
      if (hasLocalAPI) {
        await setMode({ routing: mode });
      } else {
        if (!client) throw new Error("LocalAPI not available");
        await client.updateConfig({ mode });
        await updateGeneral();
      }
    } catch (err) {
      toast.error(r(errorKind(err, hasLocalAPI)), { duration: 6000 });
    } finally {
      setOptimisticRouting(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="page gap-5">
        <Header title={t("title")} />
        <DisconnectedState
          description={!hasSub ? t("noConfigNotice") : t("disconnectedNotice")}
          onConnected={() => void update()}
        />
      </div>
    );
  }

  return (
    <SearchContext value={search}>
      <div className="page gap-4">
        {/* 页头：标题「代理」在左，右侧为小巧的搜索、测速图标、测速设置图标、模式切换 */}
        <Header title={t("title")}>
          <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:justify-between">
            {/* 紧凑搜索框 */}
            <div className="relative flex w-36 sm:w-44 xl:w-52 items-center">
              <Search
                className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground/60"
                aria-hidden="true"
              />
              <input
                className="h-8 w-full rounded-xl border border-border/80 bg-inset/60 pr-7 pl-8 text-xs text-ellipsis text-foreground placeholder:text-muted-foreground/50 hover:border-brand/40 focus:border-brand focus:bg-card focus:outline-none transition-[border-color,background-color] duration-150 max-md:h-11 max-md:text-base"
                value={search}
                placeholder={t("searchPlaceholder")}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t("searchPlaceholder")}
              />
              {search && (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 flex size-5 max-md:size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-inset hover:text-foreground"
                  onClick={() => setSearch("")}
                  aria-label={tc("clear")}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </div>

            {/* 全局測速入口收斂在「節點」區塊行（與此處同過濾集的舊入口
                已移除）；測速中的取消與進度膠囊保留在頁頭，任意 Tab 可達。 */}
            {progress.running && (
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                className="h-8 px-2 text-xs cursor-pointer text-muted-foreground hover:text-foreground"
                title={t("cancelTest")}
              >
                {t("cancelTest")}
              </Button>
            )}

            {/* 测速进度胶囊 */}
            {progress.running && progress.total > 0 && (
              <output className="rounded-lg border border-border/80 bg-inset px-2 py-1 text-caption tabular-nums text-muted-foreground">
                {progress.completed}/{progress.total}
              </output>
            )}

            {/* 测速设置纯图标按钮 */}
            <details className="relative">
              <summary
                className="flex size-8 max-md:size-11 cursor-pointer items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground transition-all duration-150 hover:bg-inset hover:text-foreground list-none [&::-webkit-details-marker]:hidden"
                title={t("parameters")}
                aria-label={t("parameters")}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              </summary>
              <div className="absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-[280px] animate-in flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-elevation-flyout backdrop-blur-md fade-in-50 zoom-in-95 duration-150 max-md:min-w-[min(280px,calc(100vw-32px))]">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t("testUrl")}
                  </span>
                  <input
                    className="h-8 rounded-lg border border-border/80 bg-inset px-2.5 text-xs text-foreground focus:border-brand outline-none max-md:h-11 max-md:text-base"
                    value={data.testURL}
                    onChange={(e) => set("testURL", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t("timeout")} (ms)
                  </span>
                  <input
                    className="h-8 rounded-lg border border-border/80 bg-inset px-2.5 text-xs text-foreground focus:border-brand outline-none max-md:h-11 max-md:text-base"
                    value={data.testTimeout}
                    type="number"
                    min={100}
                    max={30000}
                    onChange={(e) => {
                      // 清空或半輸入會被 Number() 變成 0/NaN：這會經
                      // atomWithStorage 持久化並令測速永久失效，只在
                      // 解析出有限數值時才提交。
                      const parsed = Number(e.target.value);
                      if (e.target.value !== "" && Number.isFinite(parsed))
                        set("testTimeout", parsed);
                    }}
                  />
                </label>
              </div>
            </details>

            {/* 路由模式切换：首頁已承載，移動端不再重複渲染。 */}
            {!isMobile && (
              <SegmentedControl
                ariaLabel={tc("routingMode.title")}
                value={routingValue}
                size="sm"
                options={routingOptions}
                disabled={switchingRouting}
                onChange={(mode) => void switchRouting(mode)}
              />
            )}
          </div>
        </Header>

        {/* 策略组与节点 Tabs 切换 */}
        <Tabs
          value={currentTab}
          onValueChange={handleTabChange}
          className="flex w-full min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList size="sm" className="self-start">
            <TabsTrigger value="groups">{t("groups")}</TabsTrigger>
            <TabsTrigger value="nodes">{t("nodes")}</TabsTrigger>
          </TabsList>

          <RequestStatus error={error} retry={update} isLocal={hasLocalAPI} />
          {isLoading && !error && !mapping.size && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Spinner className="size-6 text-brand" />
            </div>
          )}
          {!isLoading && !error && !mapping.size && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <p className="text-base font-medium text-foreground">
                {t("emptyNodes")}
              </p>
              <p className="max-w-md text-xs">{t("emptyNodesDesc")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/config")}
              >
                {t("manageConfig")}
              </Button>
            </div>
          )}

          <TabsContent
            value="groups"
            className="m-0 flex min-h-0 flex-1 flex-col focus-visible:ring-0"
          >
            <ProxyGroups />
          </TabsContent>

          <TabsContent value="nodes" className="m-0 focus-visible:ring-0">
            <ProxyProviders />
            <Proxies />
          </TabsContent>
        </Tabs>

        {search &&
          ![...mapping.keys()].some((name) =>
            name.toLowerCase().includes(search.toLowerCase()),
          ) && <p className="py-8 text-muted-foreground">{tc("empty")}</p>}
      </div>
    </SearchContext>
  );
}
