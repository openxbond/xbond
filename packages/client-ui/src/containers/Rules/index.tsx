import { Header, Card, Input } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { useRule, useRuleProviders, useCapabilities } from "@stores";
import type * as API from "@xbond/client/request";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { List, type RowComponentProps } from "react-window";

import { Provider } from "./Provider";

import "./style.scss";

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
  const rule = rules[index];
  return (
    <div className="rule-item" style={style}>
      <div className="flex py-1">
        <div className="rule-type w-40 text-center">{rule.type}</div>
        <div className="payload flex-1 text-center">{rule.payload}</div>
        <div className="rule-proxy w-40 text-center">{rule.proxy}</div>
      </div>
    </div>
  );
}

export default function Rules() {
  const { rules: allRules, error, update } = useRule();
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
  return (
    <div className="page">
      <RequestStatus error={error} retry={update} />
      {!capabilities.ruleProviders && capabilities.kind === "sing-box" && (
        <ProviderNote />
      )}
      <RuleProviders />
      <RuleSearch value={search} onChange={setSearch} />
      <Header className="not-first:mt-7.5" title={t("title")} />
      <Card className="mt-2.5 flex flex-1 flex-col overflow-hidden p-0 md:mt-4 focus:outline-none">
        <div className="table-header rule-header">
          <div className="w-40 text-center">{t("columns.type")}</div>
          <div className="flex-1 text-center">{t("columns.payload")}</div>
          <div className="w-40 text-center">{t("columns.proxy")}</div>
        </div>
        <AutoSizer
          className="min-h-120"
          renderProp={({ height, width }) => (
            <List
              style={{ height: height ?? 0, width: width ?? 0 }}
              rowCount={rules.length}
              rowHeight={50}
              rowComponent={RuleRow}
              rowProps={{ rules }}
            />
          )}
        />
      </Card>
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
      align="left"
      className="my-3"
      value={value}
      onChange={onChange}
    />
  );
}
