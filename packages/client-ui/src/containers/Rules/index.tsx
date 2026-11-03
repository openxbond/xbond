import { ButtonSelect, Card, Header, Input } from "@components";
import { CopyIconButton } from "@components/CopyButton";
import { EmptyState } from "@components/EmptyState";
import { RequestStatus } from "@components/RequestStatus";
import { hasDaemonConfig } from "@lib/localapi-bootstrap";
import {
  useCapabilities,
  useGlobalMixin,
  useLocalAPI,
  useRule,
  useRuleProviders,
} from "@stores";
import type * as API from "@xbond/client/request";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { List, type RowComponentProps } from "react-window";

import GlobalMixinPanel from "./GlobalMixinPanel";
import { Provider } from "./Provider";

function RuleProviders() {
  const { providers, error, update } = useRuleProviders();
  const { t } = useTranslation("rules");

  return (
    <>
      <RequestStatus error={error} retry={update} />
      {providers.length !== 0 && (
        <div className="flex flex-col">
          <Header title={t("providerTitle")} />
          <Card className="mt-4 p-0 divide-y divide-border">
            {providers.map((p) => (
              <Provider key={p.name} provider={p} />
            ))}
          </Card>
        </div>
      )}
    </>
  );
}

function RuleRow({
  index,
  style,
  rules,
}: RowComponentProps<{ rules: API.Rule[] }>) {
  const { t: tc } = useTranslation("common");
  const rule = rules[index];
  return (
    <div
      className="rule-item h-[50px] list-none overflow-hidden border-b border-border transition-colors duration-[120ms] last:border-b-0 hover:bg-inset"
      style={style}
    >
      <div className="rule-row flex h-full items-center gap-3 px-4">
        <div className="w-10 shrink-0 text-right text-label tabular-nums text-muted-foreground max-md:hidden">
          {index + 1}
        </div>
        <div className="rule-type w-44 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground max-md:hidden">
          {rule.type}
        </div>
        <div
          className="payload min-w-0 flex-1 overflow-hidden font-mono text-body text-ellipsis whitespace-nowrap text-foreground"
          title={rule.payload}
        >
          {rule.payload}
        </div>
        <div
          className="rule-proxy w-56 overflow-hidden text-right text-label text-ellipsis whitespace-nowrap text-muted-foreground max-md:hidden"
          title={rule.proxy}
        >
          {rule.proxy}
        </div>
        {/* 截斷的 payload 需要完整取用路徑：就地複製。 */}
        <CopyIconButton value={rule.payload} label={tc("copy")} />
      </div>
    </div>
  );
}

export default function Rules() {
  const { rules: allRules, error, update, isLoading } = useRule();
  const [search, setSearch] = useState("");
  const rules = allRules.filter(
    (rule) =>
      !search ||
      [rule.type, rule.payload, rule.proxy].some((value) =>
        value.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const capabilities = useCapabilities();
  const { t } = useTranslation("rules");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const supported = hasDaemonConfig();
  const { isLocalTarget } = useLocalAPI();
  const { mixin } = useGlobalMixin();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "rules" | "mixin") || "rules";

  const activeMixinCount =
    (mixin.bypassLan ? 1 : 0) +
    (mixin.rulesPrepend?.length || 0) +
    (mixin.rulesAppend?.length || 0) +
    (mixin.dns ? 1 : 0);

  return (
    <div className="page">
      <Header title={t("title")}>
        {supported && isLocalTarget && (
          <ButtonSelect<"rules" | "mixin">
            value={tab}
            options={[
              { label: t("tabActive"), value: "rules" },
              {
                label:
                  activeMixinCount > 0
                    ? `${t("tabMixin")} (${activeMixinCount})`
                    : t("tabMixin"),
                value: "mixin",
              },
            ]}
            onSelect={(nextTab) => {
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (nextTab === "rules") next.delete("tab");
                else next.set("tab", nextTab);
                return next;
              });
            }}
          />
        )}
      </Header>

      {tab === "mixin" && supported && isLocalTarget ? (
        <GlobalMixinPanel />
      ) : (
        <>
          <RequestStatus error={error} retry={update} />
          {!capabilities.ruleProviders && capabilities.kind === "sing-box" && (
            <ProviderNote />
          )}
          <div className="page-toolbar">
            <RuleSearch value={search} onChange={setSearch} />
          </div>
          <RuleProviders />
          <Card className="flex flex-1 flex-col overflow-hidden p-0 focus:outline-none">
            <div className="table-header rule-header flex shrink-0 items-center gap-3 px-4">
              <div className="w-10 shrink-0 text-right max-md:hidden">#</div>
              <div className="w-44 max-md:hidden">{t("columns.type")}</div>
              <div className="flex-1">{t("columns.payload")}</div>
              <div className="w-56 text-right max-md:hidden">
                {t("columns.proxy")}
              </div>
            </div>
            {/* CSS-only bounds: flex basis 0 sizes the box from the card's
                remaining space after the header, never from row content. */}
            <div className="rule-list-box min-h-[480px] flex-1 overflow-hidden">
              {isLoading && allRules.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {tc("loading")}
                </p>
              ) : allRules.length === 0 ? (
                <EmptyState
                  className="h-full"
                  message={t("empty")}
                  action={
                    <button
                      className="empty-state-action"
                      onClick={() => navigate("/config")}
                    >
                      {t("emptyAction")}
                    </button>
                  }
                />
              ) : rules.length === 0 ? (
                <EmptyState
                  className="h-full"
                  message={tc("empty")}
                  action={
                    <button
                      className="empty-state-action"
                      onClick={() => setSearch("")}
                    >
                      {tc("clear")}
                    </button>
                  }
                />
              ) : (
                <List
                  style={{ height: "100%", width: "100%" }}
                  rowCount={rules.length}
                  rowHeight={50}
                  rowComponent={RuleRow}
                  rowProps={{ rules }}
                />
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ProviderNote() {
  const { t } = useTranslation("runtime");
  return (
    <p className="my-3 text-sm text-muted-foreground">
      {t("providerUnavailable")}
    </p>
  );
}
function RuleSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t: tc } = useTranslation("common");
  return (
    <Input
      aria-label={tc("search")}
      placeholder={tc("search")}
      className="flex-1 text-left"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
