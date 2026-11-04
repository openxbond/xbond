import type { RulePage } from "@xbond/client/localapi";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import useSWR from "swr";

import { CopyIconButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/page-header";
import { RequestStatus } from "@/components/request-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCapabilities } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

import GlobalMixinPanel from "./global-mixin-panel";
import { useRule, useRuleProviders } from "./rule-data";
import { Provider } from "./rule-provider-row";
import { useGlobalMixin } from "./use-global-mixin";

const pageSize = 50;

function RuleProviders() {
  const { providers, error, update, isLoading } = useRuleProviders();
  const { t } = useTranslation("rules");
  const { t: common } = useTranslation("common");
  const { t: runtime } = useTranslation("runtime");
  const capabilities = useCapabilities();

  return (
    <>
      <RequestStatus error={error} retry={update} />
      {providers.length > 0 ? (
        <Card className="divide-y divide-border p-0">
          {providers.map((provider) => (
            <Provider key={provider.name} provider={provider} />
          ))}
        </Card>
      ) : (
        !error && (
          <EmptyState
            message={
              isLoading
                ? common("loading")
                : capabilities.kind === "sing-box"
                  ? runtime("providerUnavailable")
                  : t("providersEmpty")
            }
          />
        )
      )}
    </>
  );
}

function RuleRows({ rules }: Pick<RulePage, "rules">) {
  const { t } = useTranslation("rules");
  const { t: common } = useTranslation("common");
  return (
    <>
      <div className="table-header rule-row hidden grid-cols-[4rem_minmax(0,1.6fr)_minmax(0,1fr)_2rem] items-center gap-3 px-4 md:grid">
        <span>#</span>
        <span>{t("columns.payload")}</span>
        <span>{t("columns.proxy")}</span>
        <span />
      </div>
      <ul
        aria-label={t("tabActive")}
        className="max-h-[60dvh] divide-y divide-border overflow-auto"
      >
        {rules.map((rule) => (
          <li
            className="rule-item grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[4rem_minmax(0,1.6fr)_minmax(0,1fr)_2rem]"
            key={rule.index}
          >
            <span className="self-start text-label tabular-nums text-muted-foreground">
              #{rule.index}
            </span>
            <div className="min-w-0">
              <div
                className="payload truncate font-mono text-body"
                title={rule.payload || rule.type}
              >
                {rule.payload || rule.type}
              </div>
              {rule.payload && (
                <div
                  className="truncate text-label text-muted-foreground"
                  title={rule.type}
                >
                  {rule.type}
                </div>
              )}
            </div>
            <span
              className="col-start-2 row-start-2 min-w-0 truncate text-label text-muted-foreground md:col-start-3 md:row-start-1 md:text-body md:text-foreground"
              title={rule.proxy}
            >
              {rule.proxy}
            </span>
            <div className="col-start-3 row-start-1 md:col-start-4">
              <CopyIconButton
                value={rule.payload || rule.type}
                label={common("copy")}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RuleBrowser({ local }: { local: ReturnType<typeof useLocalAPI> }) {
  const { t } = useTranslation("rules");
  const { t: common } = useTranslation("common");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get("ruleSearch") ?? "";
  const matchType = params.get("matchedRuleType") ?? "";
  const matchPayload = params.get("matchedRulePayload") ?? "";
  const [draft, setDraft] = useState({ query, value: query });
  const searchValue = draft.query === query ? draft.value : query;
  const [loadRemote, setLoadRemote] = useState(false);
  const parsedPage = Number(params.get("rulePage"));
  const page =
    Number.isSafeInteger(parsedPage) &&
    Number.isSafeInteger(parsedPage * pageSize) &&
    parsedPage > 0
      ? parsedPage
      : 1;
  const offset = (page - 1) * pageSize;
  const request = new URLSearchParams({
    offset: String(offset),
    limit: String(pageSize),
  });
  if (query) request.set("q", query);
  if (matchType) {
    request.set("matchType", matchType);
    request.set("matchPayload", matchPayload);
  }
  const { config, daemonClient, isLocalTarget, status } = local;
  const unsupported = isLocalTarget && !!status && !status.rulePaging;
  const localPage = useSWR(
    isLocalTarget && !unsupported && daemonClient && config
      ? [
          "/localapi/v0/rules/page",
          config.endpoint,
          config.token,
          status?.engine.startedAt,
          request.toString(),
        ]
      : null,
    () => daemonClient?.getRulesPage(request),
    { shouldRetryOnError: false },
  );
  const remote = useRule(!isLocalTarget && loadRemote);
  const remotePage = useMemo<RulePage | undefined>(() => {
    if (!remote.rules) return;
    if (!query && !matchType) {
      return {
        total: remote.rules.length,
        rules: remote.rules
          .slice(offset, offset + pageSize)
          .map((rule, index) => ({ ...rule, index: offset + index + 1 })),
      };
    }
    const needle = query.toLowerCase();
    const typeNeedle = needle.replace(/[-_ ]/g, "");
    const matchTypeLower = matchType.toLowerCase();
    const rows: RulePage["rules"] = [];
    let total = 0;
    for (const [index, rule] of remote.rules.entries()) {
      if (
        matchType &&
        !(
          rule.type?.toLowerCase() === matchTypeLower &&
          rule.payload === matchPayload
        ) &&
        !(
          matchPayload === "" &&
          matchType === `${rule.payload} => ${rule.proxy}`
        )
      )
        continue;
      if (
        needle &&
        ![rule.payload, rule.proxy].some((value) =>
          value?.toLowerCase().includes(needle),
        ) &&
        !(
          typeNeedle &&
          rule.type?.toLowerCase().replace(/[-_ ]/g, "").includes(typeNeedle)
        )
      )
        continue;
      if (total >= offset && rows.length < pageSize)
        rows.push({ ...rule, index: index + 1 });
      total++;
    }
    return { rules: rows, total };
  }, [remote.rules, query, matchType, matchPayload, offset]);
  const result = isLocalTarget ? localPage.data : remotePage;
  const error = isLocalTarget ? localPage.error : remote.error;
  const loading = isLocalTarget
    ? !unsupported && !result && !error
    : remote.isLoading;
  const retry = isLocalTarget ? localPage.mutate : remote.update;
  const canGoBack = page > 1 && !loading;
  const canGoNext = !!result && offset + pageSize < result.total;

  function search(value: string) {
    setDraft({ query: value, value });
    if (!isLocalTarget) setLoadRemote(true);
    const next = new URLSearchParams(params);
    next.delete("matchedRuleType");
    next.delete("matchedRulePayload");
    next.delete("rulePage");
    if (value) next.set("ruleSearch", value);
    else next.delete("ruleSearch");
    setParams(next);
  }

  function goTo(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage === 1) next.delete("rulePage");
    else next.set("rulePage", String(nextPage));
    setParams(next);
  }

  return (
    <>
      <form
        className="page-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          search(searchValue.trim());
        }}
      >
        <Input
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 text-left"
          value={searchValue}
          onChange={(event) => setDraft({ query, value: event.target.value })}
        />
        <Button type="submit">{common("search")}</Button>
        {(query || matchType) && (
          <Button type="button" variant="outline" onClick={() => search("")}>
            {common("clear")}
          </Button>
        )}
      </form>
      {matchType && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-inset px-4 py-3 text-sm">
          <span className="font-semibold">{t("reportedMatch")}</span>
          <code className="min-w-0 break-all">
            {[matchType, matchPayload].filter(Boolean).join(" · ")}
          </code>
          <span className="basis-full text-muted-foreground">
            {t("matchNote")}
          </span>
        </div>
      )}
      <RequestStatus error={error} retry={retry} />
      {unsupported && <EmptyState message={t("updateDaemon")} />}
      {loading && (
        <p
          role="status"
          className="px-4 py-6 text-center text-body text-muted-foreground"
        >
          {common("loading")}
        </p>
      )}
      {!isLocalTarget && !loadRemote && (
        <EmptyState
          message={t("remoteNotice")}
          action={
            <Button variant="outline" onClick={() => setLoadRemote(true)}>
              {t("loadRemote")}
            </Button>
          }
        />
      )}
      {(result || loading) && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p
              aria-live="polite"
              className="text-label tabular-nums text-muted-foreground"
            >
              {result?.rules.length
                ? t("range", {
                    from: offset + 1,
                    to: offset + result.rules.length,
                    total: result.total,
                  })
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-disabled={!canGoBack}
                className="aria-disabled:opacity-50"
                onClick={() => {
                  if (canGoBack) goTo(page - 1);
                }}
              >
                {t("previousPage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-disabled={!canGoNext}
                className="aria-disabled:opacity-50"
                onClick={() => {
                  if (canGoNext) goTo(page + 1);
                }}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
          {result &&
            (result.rules.length > 0 ? (
              <RuleRows rules={result.rules} />
            ) : (
              <EmptyState
                className="min-h-48"
                message={
                  query || matchType || page > 1 ? t("noMatches") : t("empty")
                }
                action={
                  page > 1 ? (
                    <Button variant="outline" onClick={() => goTo(1)}>
                      {t("firstPage")}
                    </Button>
                  ) : query || matchType ? (
                    <Button variant="outline" onClick={() => search("")}>
                      {common("clear")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => navigate("/config")}
                    >
                      {t("emptyAction")}
                    </Button>
                  )
                }
              />
            ))}
        </Card>
      )}
    </>
  );
}

export default function Rules() {
  const { t, i18n } = useTranslation("rules");
  const local = useLocalAPI();
  const { mixin } = useGlobalMixin();
  const [params, setParams] = useSearchParams();
  const selected = params.get("tab");
  const tab =
    selected === "providers" || (selected === "mixin" && local.isLocalTarget)
      ? selected
      : "rules";
  const mixinCount =
    (mixin.bypassLan ? 1 : 0) +
    (mixin.rulesPrepend?.length ?? 0) +
    (mixin.rulesAppend?.length ?? 0) +
    (mixin.dns ? 1 : 0);

  return (
    <Tabs
      value={tab}
      dir={i18n.dir()}
      activationMode="manual"
      className="page"
      onValueChange={(nextTab) => {
        const next = new URLSearchParams(params);
        if (nextTab === "rules") next.delete("tab");
        else next.set("tab", nextTab);
        setParams(next);
      }}
    >
      <Header title={t("title")} />
      <TabsList aria-label={t("title")} className="max-md:w-full">
        <TabsTrigger value="rules">{t("tabActive")}</TabsTrigger>
        <TabsTrigger value="providers">{t("providerTitle")}</TabsTrigger>
        {local.isLocalTarget && (
          <TabsTrigger value="mixin">
            {t("tabMixin")}
            {mixinCount > 0 && <Badge variant="secondary">{mixinCount}</Badge>}
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="rules">
        <RuleBrowser local={local} />
      </TabsContent>
      <TabsContent value="providers">
        <RuleProviders />
      </TabsContent>
      {local.isLocalTarget && (
        <TabsContent value="mixin">
          <GlobalMixinPanel />
        </TabsContent>
      )}
    </Tabs>
  );
}
